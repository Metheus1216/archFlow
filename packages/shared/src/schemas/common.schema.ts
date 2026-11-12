import { z } from "zod";

/* ───────────────────────── 基础类型 ───────────────────────── */

/** 资源主键（§1.1）：不透明字符串，前端不得解析、不得当数字处理。 */
export const Id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "id 只允许字母、数字、下划线、连字符")
  .describe("资源主键（不透明字符串）");

/** 时间（§1.1）：ISO-8601 带时区偏移。 */
export const ISODateTime = z.iso
  .datetime({ offset: true })
  .describe("ISO-8601 时间，带时区偏移");

/** 链路 ID（§1.8）。 */
export const TraceId = z
  .string()
  .regex(/^[A-Za-z0-9-]{8,64}$/, "traceId 只允许 [A-Za-z0-9-]，长度 8–64")
  .describe("链路追踪 ID");

/** 非负整数：计数、token 数、字节数、延迟。 */
export const Count = z.number().int().nonnegative();

/* ───────────────────────── 枚举（§1.10） ───────────────────────── */

export const MessageRole = z.enum(["user", "assistant", "system"]);
export type MessageRole = z.infer<typeof MessageRole>;

export const FileType = z.enum(["text", "image", "pdf", "docx"]);
export type FileType = z.infer<typeof FileType>;

export const FileStatus = z.enum(["processing", "ready", "failed", "stored"]);
export type FileStatus = z.infer<typeof FileStatus>;

export const CardKind = z.enum(["single", "multi", "text"]);
export type CardKind = z.infer<typeof CardKind>;

export const CardStatus = z.enum(["pending", "answered", "ignored", "expired"]);
export type CardStatus = z.infer<typeof CardStatus>;

export const RunStatus = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const FinishReason = z.enum(["stop", "length", "canceled", "error"]);
export type FinishReason = z.infer<typeof FinishReason>;

/* ───────────────────────── 图（§7.6 仅约束传输形态） ───────────────────────── */

export const GRAPH_MAX_BYTES = 512 * 1024;
export const GRAPH_MAX_DEPTH = 6;

/** 图数据：nodes / edges 内部结构 TBD，服务端视为不透明 JSON。 */
export const Graph = z.looseObject({
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  version: z.number().int().positive().optional(),
});
export type Graph = z.infer<typeof Graph>;

const encoder = new TextEncoder();

const utf8ByteLength = (value: unknown): number =>
  encoder.encode(JSON.stringify(value)).length;

/** 容器嵌套深度：对象/数组各算一层，原始值算 0 层。 */
const jsonDepth = (value: unknown): number => {
  if (Array.isArray(value)) {
    let max = 0;
    for (const item of value) {
      max = Math.max(max, jsonDepth(item));
    }
    return max + 1;
  }

  if (value !== null && typeof value === "object") {
    let max = 0;
    for (const item of Object.values(value as Record<string, unknown>)) {
      max = Math.max(max, jsonDepth(item));
    }
    return max + 1;
  }

  return 0;
};

export const GRAPH_TOO_LARGE_ERROR = {
  httpStatus: 413,
  errorCode: "GRAPH_TOO_LARGE",
} as const;

export const GRAPH_INVALID_ERROR = {
  httpStatus: 422,
  errorCode: "GRAPH_INVALID",
} as const;

/** 入参图：在 Graph 之上叠加 §7.6 的大小与深度硬约束。 */
export const GraphInput = Graph.superRefine((graph, ctx) => {
  const bytes = utf8ByteLength(graph);
  if (bytes > GRAPH_MAX_BYTES) {
    ctx.addIssue({
      code: "custom",
      message: `图数据 ${bytes} 字节，超过上限 ${GRAPH_MAX_BYTES} 字节（UTF-8）`,
      params: GRAPH_TOO_LARGE_ERROR,
    });
  }

  const depth = jsonDepth(graph);
  if (depth > GRAPH_MAX_DEPTH) {
    ctx.addIssue({
      code: "custom",
      message: `图嵌套深度 ${depth} 层，超过上限 ${GRAPH_MAX_DEPTH} 层`,
      params: GRAPH_INVALID_ERROR,
    });
  }
});
export type GraphInput = z.infer<typeof GraphInput>;

export type GraphError = {
  httpStatus: 413 | 422;
  errorCode: "GRAPH_TOO_LARGE" | "GRAPH_INVALID";
};

/** 把 GraphInput 抛出的 ZodError 映射成 API 错误。 */
export const mapGraphError = (error: z.ZodError): GraphError => {
  for (const issue of error.issues) {
    const params = (issue as { params?: Partial<GraphError> }).params;
    if (params?.errorCode) {
      return {
        httpStatus: params.httpStatus as GraphError["httpStatus"],
        errorCode: params.errorCode,
      };
    }
  }

  return { ...GRAPH_INVALID_ERROR };
};

/* ───────────────────────── 通用包装（§1.3 响应外壳 / 分页） ───────────────────────── */

/** 字段级报错，用于表单精准标红。 */
export const FieldError = z.object({
  field: z.string().min(1).describe("字段路径，嵌套用 .，数组用 [i]"),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "字段错误码为大写下划线"),
  message: z.string(),
});
export type FieldError = z.infer<typeof FieldError>;

/** 分页外壳：items + 游标，供前端无限滚动。 */
export const PageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** 统一响应外壳：§1.3 失败时 data 为 null。 */
export const ApiResponseSchema = <T extends z.ZodType>(data: T) =>
  z.object({
    code: z.string().describe("大写英文常量，见 §1.5；成功为 OK"),
    message: z.string(),
    data: data.nullable(),
    errors: z.array(FieldError).optional(),
    traceId: TraceId,
  });

export type ApiResponse<T> = {
  code: string;
  message: string;
  data: T | null;
  errors?: FieldError[];
  traceId: string;
};

/* ───────────────────────── 请求参数（§1.3 分页） ───────────────────────── */

export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(256).optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;
