import "server-only";

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import {
  ERROR_CODES,
  FILE_UPLOAD_TYPES,
  FileUploadName,
  PROJECT_TREE_ITEM_LIMIT,
  type FileMeta,
  type FileStatusBrief,
  type MockDatabase,
  type MockFileRecord,
} from "@arch-flow/shared";
import { readMockDatabase, updateMockDatabase } from "./mock-db";
import { MockRunError } from "./mock-run-data";
import {
  discardMockUpload,
  isMissingMockUpload,
  MockUploadParseError,
  readMockTextUpload,
  readMockUpload,
  writeMockUpload,
} from "./mock-upload-storage";

type UploadedFile = MockFileRecord & { upload: NonNullable<MockFileRecord["upload"]> };

const IMAGE_MAX_PIXELS = 16_000_000;
const IMAGE_CHECK_SIZE = 64;
const IMAGE_CHECK_TIMEOUT_SECONDS = 8;
const MAX_ACTIVE_FILE_CHECKS = 2;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const shared = globalThis as typeof globalThis & {
  archFlowMockFileParses?: Map<string, Promise<void>>;
};

const projectUploads = (database: MockDatabase, projectId: string): UploadedFile[] => {
  if (!database.projects.some(({ id }) => id === projectId)) {
    throw new MockRunError(404, ERROR_CODES.PROJECT_NOT_FOUND, "项目不存在");
  }
  return database.files.filter((file): file is UploadedFile => file.projectId === projectId && file.upload !== undefined);
};

const toMeta = ({ id, fileName, fileType, status, errorMessage, createdAt, upload }: UploadedFile): FileMeta => ({
  id, fileName, fileType, status, createdAt,
  errorMessage: errorMessage ?? null,
  mimeType: upload.mimeType,
  sizeBytes: upload.sizeBytes,
});

const canonicalName = (fileName: string) => fileName.normalize("NFKC").toLowerCase();

export const assertMockProjectFileAccess = async (userId: string, projectId: string) => {
  projectUploads(await readMockDatabase(userId), projectId);
};

export const createMockProjectFile = async (
  userId: string, projectId: string, file: File, signal: AbortSignal,
) => {
  const name = FileUploadName.safeParse(file.name);
  if (!name.success) throw new MockRunError(422, ERROR_CODES.VALIDATION_FAILED, "文件名无效，请重命名后上传。");
  const fileName = name.data;
  const extension = path.extname(fileName).toLowerCase();
  const kind = Object.entries(FILE_UPLOAD_TYPES).find(([candidate]) => candidate === extension)?.[1];
  if (!kind) throw new MockRunError(415, ERROR_CODES.FILE_TYPE_UNSUPPORTED, "不支持此文件类型，请选择文本、图片、PDF 或 DOCX。");

  const bytes = Buffer.from(await file.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  let writtenId: string | undefined;
  try {
    return await updateMockDatabase(userId, async (database) => {
      if (signal.aborted) throw new MockRunError(408, ERROR_CODES.BAD_REQUEST, "上传已取消，请重试。");
      const files = projectUploads(database, projectId);
      const existing = files.find((entry) => canonicalName(entry.fileName) === canonicalName(fileName));
      if (existing) {
        if (existing.upload.digest !== digest) {
          throw new MockRunError(409, ERROR_CODES.FILE_NAME_CONFLICT, "项目中已存在同名资料。请重命名新文件，或先删除原文件。");
        }
        return { created: false, file: toMeta(existing) };
      }
      if (files.length >= PROJECT_TREE_ITEM_LIMIT) {
        throw new MockRunError(409, ERROR_CODES.FILE_LIMIT_EXCEEDED, "项目资料已达上限，请删除不再使用的资料后重试。");
      }

      const id = randomUUID();
      const upload: UploadedFile = {
        id, projectId, fileName,
        fileType: kind.fileType,
        status: kind.fileType === "text" || kind.fileType === "image" ? "processing" : "stored",
        errorMessage: null,
        createdAt: new Date().toISOString(),
        upload: { mimeType: kind.mimeType, sizeBytes: bytes.length, digest },
      };
      await writeMockUpload(userId, id, bytes);
      writtenId = id;
      database.files.unshift(upload);
      return { created: true, file: toMeta(upload) };
    });
  } catch (error) {
    if (writtenId) await discardMockUpload(userId, writtenId);
    throw error;
  }
};

const matchesImageHeader = (bytes: Buffer, mimeType: string) => {
  switch (mimeType) {
    case "image/png": return bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
    case "image/jpeg": return bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE);
    case "image/webp": return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    default: return false;
  }
};

const parseUpload = async (userId: string, file: UploadedFile): Promise<string | null> => {
  try {
    if (file.fileType === "text") await readMockTextUpload(userId, file.id);
    if (file.fileType === "image") {
      const bytes = await readMockUpload(userId, file.id);
      if (!matchesImageHeader(bytes, file.upload.mimeType)) {
        return "图片内容与扩展名不一致，请重新导出后上传。";
      }
      try {
        await sharp(bytes, { failOn: "warning", limitInputPixels: IMAGE_MAX_PIXELS })
          .resize(IMAGE_CHECK_SIZE, IMAGE_CHECK_SIZE, { fit: "inside", withoutEnlargement: true })
          .timeout({ seconds: IMAGE_CHECK_TIMEOUT_SECONDS })
          .raw().toBuffer();
      } catch {
        return "无法解析图片，请检查文件是否损坏，或缩小尺寸后重新上传。";
      }
    }
    return null;
  } catch (error) {
    if (error instanceof MockUploadParseError) return error.message;
    if (isMissingMockUpload(error)) return "原文件已不可用，请删除此记录后重新上传。";
    throw error;
  }
};

const processUpload = (userId: string, file: UploadedFile) => {
  const activeParses = (shared.archFlowMockFileParses ??= new Map());
  const key = `${userId}:${file.id}`;
  const active = activeParses.get(key);
  if (active) return active;
  if (activeParses.size >= MAX_ACTIVE_FILE_CHECKS) return null;

  const parse = async () => {
    try {
      const errorMessage = await parseUpload(userId, file);
      await updateMockDatabase(userId, (database) => {
        const current = database.files.find(({ id, projectId }) => id === file.id && projectId === file.projectId);
        if (current?.status !== "processing") return;
        current.status = errorMessage ? "failed" : "ready";
        current.errorMessage = errorMessage;
      });
    } finally {
      activeParses.delete(key);
    }
  };
  const pending = parse();
  activeParses.set(key, pending);
  return pending;
};

export const getMockProjectFileStatuses = async (
  userId: string, projectId: string, ids: string[],
): Promise<FileStatusBrief[]> => {
  const selectedIds = new Set(ids);
  const files = projectUploads(await readMockDatabase(userId), projectId);
  let processed = false;
  for (const file of files) {
    if (selectedIds.has(file.id) && file.status === "processing") {
      const pending = processUpload(userId, file);
      if (pending) {
        await pending;
        processed = true;
      }
    }
  }
  const current = new Map((processed ? projectUploads(await readMockDatabase(userId), projectId) : files)
    .map((file) => [file.id, file]));
  return [...selectedIds].flatMap((id) => {
    const file = current.get(id);
    return file ? [{ id, status: file.status, errorMessage: file.errorMessage ?? null }] : [];
  });
};
