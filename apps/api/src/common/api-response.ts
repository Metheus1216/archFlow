import { HttpException } from "@nestjs/common";
import { ERROR_CODES, TraceId, type ApiResponse } from "@arch-flow/shared";
import { randomUUID } from "node:crypto";
import type { Request } from "express";

const traceIds = new WeakMap<Request, string>();

export const getTraceId = (request: Request): string => {
  const assigned = traceIds.get(request);
  if (assigned) return assigned;

  const incoming = TraceId.safeParse(request.headers["x-request-id"]);
  const traceId = incoming.success ? incoming.data : randomUUID();
  traceIds.set(request, traceId);
  return traceId;
};

export const apiOk = <T>(request: Request, data: T, traceId = getTraceId(request)): ApiResponse<T> => {
  traceIds.set(request, traceId);
  request.res?.setHeader("X-Trace-Id", traceId);
  return { code: ERROR_CODES.OK, message: "ok", data, traceId };
};

export const apiError = (status: number, code: string, message: string): HttpException =>
  new HttpException({ code, message }, status);
