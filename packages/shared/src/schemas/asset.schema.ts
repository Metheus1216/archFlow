import { z } from "zod";
import {
  Graph,
  GraphInput,
  Id,
  ISODateTime,
  PaginationQuery,
} from "./common.schema.js";

/** 资产元信息：列表项与详情共用。 */
export const AssetMeta = z.object({
  id: Id,
  name: z.string(),
  createdAt: ISODateTime,
  updatedAt: ISODateTime,
});
export type AssetMeta = z.infer<typeof AssetMeta>;

/** 资产详情：元信息 + 图数据（原 AssetSchema 的 graphData）。 */
export const Asset = AssetMeta.extend({
  graph: Graph,
});
export type Asset = z.infer<typeof Asset>;

/* ───────────────────────── 请求 DTO（§8） ───────────────────────── */

/** 新建 / 保存资产（§8.2）：graph 走 GraphInput（512KB、≤6 层）。 */
export const AssetInput = z.object({
  name: z.string().trim().min(1).max(50),
  graph: GraphInput,
});
export type AssetInput = z.infer<typeof AssetInput>;

/** 更新资产（§8.4）：PATCH，至少改一项。 */
export const AssetUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    graph: GraphInput.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "至少需要修改一项",
  });
export type AssetUpdateInput = z.infer<typeof AssetUpdateInput>;

/** 资产列表查询（§8.2）。 */
export const AssetListQuery = PaginationQuery;
export type AssetListQuery = z.infer<typeof AssetListQuery>;

/** 资产详情查询（§8.3）：includeGraph 默认 true；false 时只返回 AssetMeta。 */
export const AssetDetailQuery = z.object({
  includeGraph: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});
export type AssetDetailQuery = z.infer<typeof AssetDetailQuery>;

/** 详情响应：includeGraph=true 为 Asset，false 为 AssetMeta。 */
export const AssetDetail = z.union([Asset, AssetMeta]);
export type AssetDetail = z.infer<typeof AssetDetail>;
