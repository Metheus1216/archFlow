import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { addAbortSignal } from "node:stream";
import { AgentExecutionError, type AgentEmbedding } from "@arch-flow/agent";
import { DocumentChunkEntity, KnowledgeFileEntity, ProjectEntity } from "@arch-flow/db";
import {
  ERROR_CODES, FILE_UPLOAD_MAX_BYTES, FILE_UPLOAD_TYPES, FileMeta, FileStatusResult,
  type FileIdsQuery, type FileListQuery,
} from "@arch-flow/shared";
import { HttpException, Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import sharp from "sharp";
import { In } from "typeorm";
import { z } from "zod";
import { apiError } from "../../common/api-response.js";
import { DatabaseService } from "../../database/database.service.js";
import { StorageService } from "../../infra/storage.service.js";
import { paginateWorkspaceRows } from "../workspace/workspace-pagination.js";
import { getWorkspaceProject } from "../workspace/workspace.service.js";
import { KNOWLEDGE_EMBEDDING, serializeKnowledgeVector } from "./knowledge-embedding.js";

const INDEX_INTERVAL_MS = 5_000;
const INDEX_TIMEOUT_MS = 5 * 60_000;
const CHUNK_LENGTH = 1200;
const CHUNK_OVERLAP = 160;
const EMBED_BATCH_SIZE = 16;
const IMAGE_PIXEL_LIMIT = 40_000_000;
const FILE_MISSING = "项目资料不存在。";

const toFile = (row: KnowledgeFileEntity) => FileMeta.parse({
  id: row.uuid,
  fileName: row.fileName,
  fileType: row.fileType,
  mimeType: row.mimeType,
  sizeBytes: row.fileSize,
  status: row.status,
  errorMessage: row.errorMessage,
  createdAt: row.createdAt.toISOString(),
});

class FileIndexError extends Error {}

const decodeText = (bytes: Buffer) => {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    throw new FileIndexError("文件编码无法识别，请上传 UTF-8 文本。");
  }
  if (!text || text.includes("\0")) throw new FileIndexError("文件中没有可引用的文本，请重新上传。");
  return text;
};

const unicodeBoundary = (text: string, index: number) => {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff ? index - 1 : index;
};

@Injectable()
export class KnowledgeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly shutdown = new AbortController();
  private timer?: ReturnType<typeof setInterval>;
  private worker?: Promise<void>;

  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    @Inject(KNOWLEDGE_EMBEDDING) private readonly embed: AgentEmbedding | null,
  ) {}

  upload = async (ownerId: string, projectId: string, name: string, bytes: Buffer) => {
    const source = this.database.dataSource;
    const project = await getWorkspaceProject(source.manager, ownerId, projectId);
    const extension = extname(name).toLowerCase();
    const type = Object.entries(FILE_UPLOAD_TYPES).find(([suffix]) => suffix === extension)?.[1];
    if (!type) throw apiError(415, ERROR_CODES.FILE_TYPE_UNSUPPORTED, "不支持这种文件格式。");
    if (type.fileType === "text" && !this.embed)
      throw apiError(503, ERROR_CODES.SERVICE_UNAVAILABLE, "未配置向量模型，文本资料暂时无法入库。");
    const status = type.fileType === "pdf" || type.fileType === "docx" ? "stored" : "processing";
    const uuid = randomUUID();
    const objectKey = `${project.uuid}/${uuid}`;
    try {
      await this.storage.client.putObject(this.storage.bucket, objectKey, bytes, bytes.length, { "Content-Type": type.mimeType });
    } catch {
      throw apiError(503, ERROR_CODES.SERVICE_UNAVAILABLE, "资料存储暂不可用，请稍后重试。");
    }

    let saved: KnowledgeFileEntity;
    try {
      saved = await source.transaction(async (manager) => {
        await getWorkspaceProject(manager, ownerId, project.uuid, "pessimistic_write");
        const incoming = name.normalize("NFKC");
        if (await manager.getRepository(KnowledgeFileEntity).createQueryBuilder("file")
          .where("file.project_id = :projectId", { projectId: project.id })
          .andWhere("lower(normalize(file.file_name, NFKC)) = lower(:incoming)", { incoming })
          .getExists()) {
          throw apiError(409, ERROR_CODES.FILE_NAME_CONFLICT, "项目已有同名文件，请改名后上传。");
        }
        return manager.save(KnowledgeFileEntity, {
          uuid, projectId: project.id, fileName: name, fileType: type.fileType,
          mimeType: type.mimeType, fileSize: bytes.length, fileUrl: objectKey, status,
        });
      });
    } catch (error) {
      const committed = await this.reconcileUpload(uuid, objectKey);
      if (!committed) {
        if (error instanceof HttpException) throw error;
        throw apiError(503, ERROR_CODES.SERVICE_UNAVAILABLE, "文件记录暂时无法保存，请稍后重试。");
      }
      saved = committed;
    }
    if (saved.status === "processing") this.schedule();
    return toFile(saved);
  };

  list = async (ownerId: string, projectId: string, pagination: FileListQuery) => {
    const manager = this.database.dataSource.manager;
    const project = await getWorkspaceProject(manager, ownerId, projectId);
    const query = manager.getRepository(KnowledgeFileEntity).createQueryBuilder("file")
      .where("file.project_id = :projectId", { projectId: project.id });
    if (pagination.status) query.andWhere("file.status = :status", { status: pagination.status });
    const page = await paginateWorkspaceRows(query, pagination, "created_at");
    return { ...page, items: page.items.map(toFile) };
  };

  statuses = async (ownerId: string, projectId: string, query: FileIdsQuery) => {
    const manager = this.database.dataSource.manager;
    const project = await getWorkspaceProject(manager, ownerId, projectId);
    const uuids = query.ids.filter((id) => z.uuid().safeParse(id).success);
    const files = await manager.findBy(KnowledgeFileEntity, { projectId: project.id, uuid: In(uuids) });
    return FileStatusResult.parse({ items: files.map(({ uuid, status, errorMessage }) => ({ id: uuid, status, errorMessage })) });
  };

  detail = async (ownerId: string, fileId: string) => {
    if (!z.uuid().safeParse(fileId).success) throw apiError(404, ERROR_CODES.FILE_NOT_FOUND, FILE_MISSING);
    const file = await this.database.dataSource.getRepository(KnowledgeFileEntity).createQueryBuilder("file")
      .innerJoin(ProjectEntity, "project", "project.id = file.project_id")
      .where("project.user_id = :ownerId AND file.uuid = :fileId", { ownerId, fileId })
      .getOne();
    if (!file) throw apiError(404, ERROR_CODES.FILE_NOT_FOUND, FILE_MISSING);
    return toFile(file);
  };

  onApplicationBootstrap = () => {
    this.timer = setInterval(this.schedule, INDEX_INTERVAL_MS);
    this.timer.unref();
    this.schedule();
  };

  onModuleDestroy = async () => {
    clearInterval(this.timer);
    this.shutdown.abort();
    await this.worker;
  };

  private reconcileUpload = async (uuid: string, objectKey: string) => {
    try {
      const file = await this.database.dataSource.manager.findOneBy(KnowledgeFileEntity, { uuid });
      if (file) return file;
      await this.storage.client.removeObject(this.storage.bucket, objectKey);
    } catch {
      this.logger.warn(`待核对的资料上传 fileId=${uuid}`);
    }
    return null;
  };

  private schedule = () => {
    if (this.worker || this.shutdown.signal.aborted) return;
    this.worker = this.drain();
  };

  private drain = async () => {
    try {
      const repository = this.database.dataSource.getRepository(KnowledgeFileEntity);
      while (!this.shutdown.signal.aborted) {
        const file = await repository.findOne({
          where: { status: "processing", fileType: In(this.embed ? ["text", "image"] : ["image"]) },
          order: { id: "ASC" },
        });
        if (!file) break;
        await this.indexFile(file);
      }
    } catch {
      this.logger.warn("资料索引循环暂时中断，将重新读取待处理文件");
    } finally {
      this.worker = undefined;
    }
  };

  private readObject = async (file: KnowledgeFileEntity, signal: AbortSignal) => {
    signal.throwIfAborted();
    const object = addAbortSignal(signal, await this.storage.client.getObject(this.storage.bucket, file.fileUrl));
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of object as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > file.fileSize || size > FILE_UPLOAD_MAX_BYTES) throw new FileIndexError("文件内容与上传记录不一致。");
      chunks.push(chunk);
    }
    if (size !== file.fileSize) throw new FileIndexError("文件内容与上传记录不一致。");
    return Buffer.concat(chunks, size);
  };

  private indexFile = async (file: KnowledgeFileEntity) => {
    const manager = this.database.dataSource.manager;
    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(INDEX_TIMEOUT_MS)]);
    try {
      await manager.delete(DocumentChunkEntity, { knowledgeId: file.id });
      const bytes = await this.readObject(file, signal);
      if (file.fileType === "image") {
        try {
          const { format, width, height } = await sharp(bytes, { limitInputPixels: IMAGE_PIXEL_LIMIT }).metadata();
          if (!width || !height || file.mimeType !== `image/${format}`) throw new Error();
        } catch {
          throw new FileIndexError("图片内容损坏或与扩展名不一致，请重新上传。");
        }
      } else {
        const embed = this.embed;
        if (!embed) throw new FileIndexError("未配置向量模型，无法解析文本资料。");
        const text = decodeText(bytes);
        let offset = 0;
        while (offset < text.length) {
          signal.throwIfAborted();
          const segments: string[] = [];
          while (offset < text.length && segments.length < EMBED_BATCH_SIZE) {
            const end = unicodeBoundary(text, Math.min(text.length, offset + CHUNK_LENGTH));
            const part = text.slice(offset, end).trim();
            if (part) segments.push(part);
            offset = end === text.length ? end : unicodeBoundary(text, end - CHUNK_OVERLAP);
          }
          if (!segments.length) continue;
          const vectors = await embed(segments, signal);
          signal.throwIfAborted();
          if (vectors.length !== segments.length) throw new FileIndexError("向量模型返回的数据不完整。");
          await manager.insert(DocumentChunkEntity, segments.map((content, index) => ({
            projectId: file.projectId, knowledgeId: file.id, content, embedding: serializeKnowledgeVector(vectors[index]!),
          })));
        }
      }
      signal.throwIfAborted();
      await manager.update(KnowledgeFileEntity, { id: file.id, status: "processing" }, { status: "ready", errorMessage: null });
    } catch (error) {
      if (this.shutdown.signal.aborted) return;
      const errorMessage = error instanceof FileIndexError || error instanceof AgentExecutionError
        ? error.message
        : signal.aborted ? "资料解析超时，请拆分文件后再试。" : "资料解析失败，请检查文件或向量服务。";
      await this.database.dataSource.transaction(async (transaction) => {
        await transaction.delete(DocumentChunkEntity, { knowledgeId: file.id });
        await transaction.update(KnowledgeFileEntity, { id: file.id, status: "processing" }, { status: "failed", errorMessage });
      });
      this.logger.warn(`资料解析失败 fileId=${file.uuid}`);
    }
  };
}
