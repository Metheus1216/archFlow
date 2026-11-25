import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { ERROR_CODES } from "@arch-flow/shared";
import type { Request } from "express";
import { apiError } from "../../common/api-response.js";
import { loadEnv } from "../../config/env.js";

const hasTrustedOrigin = (request: Request, expected: string): boolean => {
  if (request.headers.origin !== undefined) return request.headers.origin === expected;

  const referer = request.headers.referer;
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
};

@Injectable()
export class AuthOriginGuard implements CanActivate {
  canActivate = (context: ExecutionContext): boolean => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!hasTrustedOrigin(request, loadEnv().WEB_ORIGIN)) {
      throw apiError(403, ERROR_CODES.BAD_REQUEST, "请求来源不受信任");
    }
    return true;
  };
}
