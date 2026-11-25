import { z } from "zod";
import {
  Count,
  FileStatus,
  FileType,
  Id,
  ISODateTime,
  PaginationQuery,
} from "./common.schema.js";

export const FILE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536;
export const FILE_UPLOAD_TYPES = {
  ".md": { fileType: "text", mimeType: "text/markdown" },
  ".markdown": { fileType: "text", mimeType: "text/markdown" },
  ".txt": { fileType: "text", mimeType: "text/plain" },
  ".png": { fileType: "image", mimeType: "image/png" },
  ".jpg": { fileType: "image", mimeType: "image/jpeg" },
  ".jpeg": { fileType: "image", mimeType: "image/jpeg" },
  ".webp": { fileType: "image", mimeType: "image/webp" },
  ".pdf": { fileType: "pdf", mimeType: "application/pdf" },
  ".docx": { fileType: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
} as const satisfies Record<string, { fileType: FileType; mimeType: string }>;
export const FILE_UPLOAD_EXTENSIONS = Object.keys(FILE_UPLOAD_TYPES);
export const FileUploadName = z.string().trim().min(1).max(255).regex(/^[^/\\\p{Cc}]+$/u);
export const FileUploadSize = Count.min(1).max(FILE_UPLOAD_MAX_BYTES);

/** 知识库文件完整元信息（§7.3）；项目树里用精简的 FileBrief。 */
export const FileMeta = z.object({
  id: Id,
  fileName: z.string(),
  fileType: FileType,
  mimeType: z.string(),
  sizeBytes: Count,
  status: FileStatus,
  errorMessage: z.string().nullable(),
  createdAt: ISODateTime,
});
export type FileMeta = z.infer<typeof FileMeta>;

/* ───────────────────────── 查询参数（§7） ───────────────────────── */

/** 文件列表（§7.3）：分页 + 按解析状态过滤。 */
export const FileListQuery = PaginationQuery.extend({
  status: FileStatus.optional(),
});
export type FileListQuery = z.infer<typeof FileListQuery>;

/** 批量查询解析状态（§7.3）：ids 以逗号分隔，最多 20 个。 */
export const FileIdsQuery = z.object({
  ids: z.preprocess(
    (value) =>
      typeof value === "string"
        ? value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : value,
    z.array(Id).min(1).max(20),
  ),
});
export type FileIdsQuery = z.infer<typeof FileIdsQuery>;

/** 批量状态项（§7.3）：stored 为终态。 */
export const FileStatusBrief = z.object({
  id: Id,
  status: FileStatus,
  errorMessage: z.string().nullable(),
});
export type FileStatusBrief = z.infer<typeof FileStatusBrief>;

export const FileStatusResult = z.object({
  items: z.array(FileStatusBrief),
});
export type FileStatusResult = z.infer<typeof FileStatusResult>;
