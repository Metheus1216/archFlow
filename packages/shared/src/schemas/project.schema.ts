import { z } from "zod";
import {
  FileStatus,
  FileType,
  Id,
  ISODateTime,
} from "./common.schema.js";

/* ───────────────────────── 项目 ───────────────────────── */

export const Project = z.object({
  id: Id,
  name: z.string(),
  description: z.string().nullable(),
  createdAt: ISODateTime,
  updatedAt: ISODateTime,
});
export type Project = z.infer<typeof Project>;

/* ───────────────────────── 侧边栏简要信息（§3.1） ───────────────────────── */

export const FileBrief = z.object({
  id: Id,
  fileName: z.string(),
  fileType: FileType,
  status: FileStatus,
  createdAt: ISODateTime,
});
export type FileBrief = z.infer<typeof FileBrief>;

export const AssetBrief = z.object({
  id: Id,
  name: z.string(),
  createdAt: ISODateTime,
});
export type AssetBrief = z.infer<typeof AssetBrief>;

export const ConversationBrief = z.object({
  id: Id,
  title: z.string(),
  updatedAt: ISODateTime,
});
export type ConversationBrief = z.infer<typeof ConversationBrief>;

/** 项目树节点：嵌套数组固定返回最近 20 条。 */
export const ProjectNode = Project.extend({
  lastActiveConversationId: Id.nullable(),
  files: z.array(FileBrief).max(20),
  assets: z.array(AssetBrief).max(20),
  conversations: z.array(ConversationBrief).max(20),
});
export type ProjectNode = z.infer<typeof ProjectNode>;

/* ───────────────────────── 请求 DTO（§3） ───────────────────────── */

/** 新建项目（§3.2）：名称 1–20 字符；先 trim 再计长度。 */
export const CreateProjectInput = z.object({
  name: z.string().trim().min(1).max(20),
  description: z.string().trim().max(200).optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

/** 更新项目（§3.3）：PATCH，至少改一项。 */
export const UpdateProjectInput = CreateProjectInput.partial().refine(
  (value) => Object.values(value).some((item) => item !== undefined),
  { message: "至少需要修改一项" },
);
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;
