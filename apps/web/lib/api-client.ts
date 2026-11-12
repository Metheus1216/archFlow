import type { FieldError } from "@arch-flow/shared";
import { ERROR_CODES } from "@arch-flow/shared/constants/error-codes";

export class ApiError extends Error {
  code: string;
  errors?: FieldError[];

  constructor(code: string, message: string, errors?: FieldError[]) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.errors = errors;
  }
}

type ApiEnvelope = {
  code: string;
  message: string;
  data: unknown;
  errors?: FieldError[];
  traceId: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseFieldErrors = (value: unknown): FieldError[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const errors = value.flatMap((item) =>
    isRecord(item) &&
    typeof item.field === "string" &&
    typeof item.code === "string" &&
    typeof item.message === "string"
      ? [{ field: item.field, code: item.code, message: item.message }]
      : [],
  );

  return errors.length > 0 ? errors : undefined;
};

/**
 * 只校验统一响应外壳（API 文档 §1.3）。
 *
 * 实体字段的 Zod 校验由服务端在返回前完成（mock 路由的 mockOk、真实 API 的
 * ZodValidationPipe），客户端不再重复 parse 一遍：
 * 这份重复校验会把整个 zod 及全部 locale 打进首屏 JS（dev 下约 1.5MB）。
 * 返回类型仍由 @arch-flow/shared 的 schema 推导，调用方用泛型声明期望数据。
 */
const parseEnvelope = (payload: unknown): ApiEnvelope => {
  if (
    !isRecord(payload) ||
    typeof payload.code !== "string" ||
    typeof payload.message !== "string" ||
    typeof payload.traceId !== "string" ||
    !("data" in payload)
  ) {
    throw new Error("服务端响应不符合 ApiResponse 契约");
  }

  return {
    code: payload.code,
    message: payload.message,
    data: payload.data,
    errors: parseFieldErrors(payload.errors),
    traceId: payload.traceId,
  };
};

const readEnvelope = async (response: Response): Promise<ApiEnvelope> => {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new Error(`服务端返回了非法 JSON（HTTP ${response.status}）`);
  }

  return parseEnvelope(payload);
};

/**
 * 无响应体的请求入口：用于 DELETE 等契约规定 `204 No Content` 的接口。
 * 失败时仍按统一外壳解析错误信息。
 */
export const requestApiVoid = async (
  path: string,
  init?: RequestInit,
): Promise<void> => {
  const response = await fetch(path, init);

  if (response.ok) {
    return;
  }

  const envelope = await readEnvelope(response);

  throw new ApiError(envelope.code, envelope.message, envelope.errors);
};

/**
 * 统一请求入口：校验 ApiResponse 外壳并返回 data。
 * 失败（code !== OK 或 data === null）抛 ApiError。
 */
export const requestApi = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  const envelope = await readEnvelope(response);

  if (envelope.code !== ERROR_CODES.OK || envelope.data === null) {
    throw new ApiError(envelope.code, envelope.message, envelope.errors);
  }

  /**
   * data 的字段形状由服务端按同一份 Zod schema 产出；
   * 客户端只做了外壳检查，因此这里用调用方泛型收窄。
   */
  return envelope.data as T;
};
