import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ApiResponseSchema,
  ERROR_CODES,
  type FieldError,
} from "@arch-flow/shared";

/**
 * 开发环境默认开启；production 默认关闭。
 * 本地做 production 预览时显式设置 MOCK_API=1 再 next start，
 * 不要把这个变量带到线上部署。
 */
export const MOCK_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.MOCK_API === "1";

export const mockOk = <T>(
  schema: z.ZodType<T>,
  data: T,
  status = 200,
): NextResponse => {
  const envelope = ApiResponseSchema(schema).parse({
    code: ERROR_CODES.OK,
    message: "success",
    data,
    traceId: crypto.randomUUID(),
  });

  return NextResponse.json(envelope, { status });
};

export const mockError = (
  status: number,
  code: string,
  message: string,
  errors?: FieldError[],
): NextResponse =>
  NextResponse.json(
    {
      code,
      message,
      data: null,
      errors,
      traceId: crypto.randomUUID(),
    },
    { status },
  );

export const mockDisabled = (): NextResponse =>
  mockError(
    404,
    ERROR_CODES.BAD_REQUEST,
    "Mock API 未启用（本地 production 预览请设置 MOCK_API=1）",
  );

/** 删除成功：契约规定返回 204 No Content，仅通过响应头暴露 traceId。 */
export const mockNoContent = (): NextResponse =>
  new NextResponse(null, {
    status: 204,
    headers: { "X-Trace-Id": crypto.randomUUID() },
  });

export const toFieldErrors = (error: z.ZodError): FieldError[] =>
  error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "body",
    code: ERROR_CODES.VALIDATION_FAILED,
    message: issue.message,
  }));
