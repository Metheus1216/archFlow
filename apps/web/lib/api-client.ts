import { z } from "zod";
import {
  ApiResponseSchema,
  ERROR_CODES,
  type ApiResponse,
  type FieldError,
} from "@arch-flow/shared";

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

/**
 * 统一请求入口：按传入的 Zod schema 解析 ApiResponse 外壳并返回 data。
 * 失败（code !== OK 或 data === null）抛 ApiError。
 */
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

  const payload: unknown = await response.json();
  const envelope: ApiResponse<unknown> = ApiResponseSchema(
    z.unknown(),
  ).parse(payload);

  throw new ApiError(envelope.code, envelope.message, envelope.errors);
};

export const requestApi = async <T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> => {
  const headers = new Headers(init?.headers);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  const payload: unknown = await response.json();
  const envelope: ApiResponse<T> = ApiResponseSchema(schema).parse(payload);

  if (envelope.code !== ERROR_CODES.OK || envelope.data === null) {
    throw new ApiError(envelope.code, envelope.message, envelope.errors);
  }

  return envelope.data;
};
