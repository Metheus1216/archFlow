import {
  AgentKnowledgeQuery,
  Citation,
  ERROR_CODES,
  FileStatus,
  FileType,
  type Citation as CitationResult,
} from "@arch-flow/shared";
import {
  AgentExecutionError,
  KNOWLEDGE_FILE_EXTENSION,
  type AgentEmbedding,
  type CreateAgentEngineOptions,
} from "@arch-flow/agent";
import type { DataSource } from "typeorm";
import { z } from "zod";
import { serializeKnowledgeVector } from "../knowledge/knowledge-embedding.js";

const MAX_EVIDENCE = 5;
const MIN_SIMILARITY = 0.25;
const SQL_SCOPE = `
  FROM projects AS p
  JOIN documents_chunks AS d ON d.project_id = p.id
  JOIN knowledge_base AS f ON f.id = d.knowledge_id AND f.project_id = p.id
  WHERE p.uuid = $1 AND f.status = 'ready' AND f.file_type IN ('text', 'image')
    AND ($2::uuid[] = '{}'::uuid[] OR f.uuid = ANY($2::uuid[]))`;
const ProjectFile = z.object({ id: z.uuid(), name: z.string(), status: FileStatus, fileType: FileType });

const fold = (value: string) => value.normalize("NFKC").toLowerCase();
const unavailable = (message: string) => new AgentExecutionError(ERROR_CODES.AGENT_KNOWLEDGE_REQUIRED, message);

const narrowToFiles = async (dataSource: DataSource, projectId: string, fileIds: string[], fileNames: string[]) => {
  if (fileNames.length === 0 && fileIds.length === 0) return [];
  const rows: unknown = await dataSource.query(`
    SELECT f.uuid AS id, f.file_name AS name, f.status, f.file_type AS "fileType"
    FROM projects p JOIN knowledge_base f ON f.project_id = p.id
    WHERE p.uuid = $1
      AND ($2::uuid[] = '{}'::uuid[] OR f.uuid = ANY($2::uuid[]))
  `, [projectId, fileIds]);
  const files = z.array(ProjectFile).parse(rows);
  const resolveName = (label: string) => {
    const name = fold(label);
    const exact = files.filter((file) => fold(file.name) === name);
    const matches = exact.length || KNOWLEDGE_FILE_EXTENSION.test(name) ? exact
      : files.filter((file) => fold(file.name).replace(KNOWLEDGE_FILE_EXTENSION, "") === name);
    if (!matches.length) throw unavailable(fileIds.length
      ? `所选附件中找不到「${label}」，请检查资料名称。`
      : `当前项目找不到「${label}」这份资料。`);
    if (matches.length > 1) throw unavailable(`「${label}」对应多份资料，请指定完整文件名。`);
    return matches[0]!;
  };
  const selected = fileNames.length ? [...new Set(fileNames)].map(resolveName) : files;
  for (const file of selected) {
    if (file.status === "processing") throw unavailable(`「${file.name}」正在解析，请完成后再试。`);
    if (file.status === "failed") throw unavailable(`「${file.name}」解析失败，暂时没有可引用的原文。`);
    if (file.status === "stored") throw unavailable(`「${file.name}」仅存储，没有可引用的解析结果。`);
    if (file.fileType === "image") throw unavailable(`「${file.name}」已完成图片读取，暂时没有可引用的文本。`);
  }
  return selected.map(({ id }) => id);
};

/** Intent matching may use another embedding shape. Only 1536-d vectors may enter this query. */
export const createKnowledgeSearch =
  (
    dataSource: DataSource,
    embed?: AgentEmbedding,
  ): NonNullable<CreateAgentEngineOptions["searchKnowledge"]> =>
  async (input, signal): Promise<CitationResult[]> => {
    const { projectId, attachments, query, fileNames = [] } = AgentKnowledgeQuery.parse(input);
    const projectUuid = z.uuid().parse(projectId);
    const fileIds = z.array(z.uuid()).parse(attachments);
    signal?.throwIfAborted();
    const selected = await narrowToFiles(dataSource, projectUuid, fileIds, fileNames);
    if ((fileIds.length || fileNames.length) && selected.length === 0) return [];
    const scope = [projectUuid, selected] as const;
    signal?.throwIfAborted();

    const eligible: unknown[] = await dataSource.query(
      `SELECT 1 ${SQL_SCOPE} LIMIT 1`,
      [...scope],
    );
    if (eligible.length === 0) return [];
    if (!embed)
      throw new AgentExecutionError(
        ERROR_CODES.SERVICE_UNAVAILABLE,
        "知识库检索暂不可用，请配置向量模型",
      );

    const [vector] = await embed([query], signal);
    signal?.throwIfAborted();
    const serializedVector = serializeKnowledgeVector(vector ?? []);

    const rows: unknown = await dataSource.query(
      `
    SELECT f.uuid AS "fileId", f.file_name AS "fileName", left(d.content, 2000) AS snippet,
      least(1, greatest(0, 1 - (d.embedding <=> $3::vector))) AS score
    ${SQL_SCOPE}
      AND (d.embedding <=> $3::vector) <= $4
    ORDER BY d.embedding <=> $3::vector
    LIMIT $5
  `,
      [...scope, serializedVector, 1 - MIN_SIMILARITY, MAX_EVIDENCE],
    );
    signal?.throwIfAborted();
    return z.array(Citation).parse(rows);
  };
