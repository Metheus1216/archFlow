import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
  createParamDecorator,
  type ExecutionContext,
} from "@nestjs/common";
import {
  AccessTokenResult,
  ERROR_CODES,
  IdempotencyKey,
  LoginInput,
  LogoutInput,
  RegisterInput,
} from "@arch-flow/shared";
import type { CookieOptions, Request, Response } from "express";
import { apiError, apiOk, getTraceId } from "../../common/api-response.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AuthOriginGuard } from "./auth-origin.guard.js";
import { AuthGuard, type AuthenticatedRequest } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";

const REFRESH_COOKIE = "refreshToken";
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/api/v1/auth",
} satisfies CookieOptions;

const RegistrationKey = createParamDecorator((_input: unknown, context: ExecutionContext) =>
  context.switchToHttp().getRequest<Request>().headers["idempotency-key"],
);

const refreshCookie = (request: Request): string => {
  const prefix = `${REFRESH_COOKIE}=`;
  return request.headers.cookie?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length) ?? "";
};

const setRefreshCookie = (response: Response, token: string, lifetimeMs: number): void => {
  response.cookie(REFRESH_COOKIE, token, { ...REFRESH_COOKIE_OPTIONS, maxAge: lifetimeMs });
};

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("register")
  @UseGuards(AuthOriginGuard)
  @Header("Cache-Control", "no-store")
  async register(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @RegistrationKey(new ZodValidationPipe(IdempotencyKey)) key: string,
    @Body(new ZodValidationPipe(RegisterInput)) input: RegisterInput,
  ) {
    const result = await this.auth.register(input, key, getTraceId(request));
    if (result.status === "busy") {
      response.setHeader("Retry-After", "1");
      throw apiError(409, ERROR_CODES.BAD_REQUEST, "注册请求正在处理，请稍后重试");
    }
    setRefreshCookie(response, result.refreshToken, result.lifetimeMs);
    return apiOk(request, result.auth, result.traceId);
  }

  @Post("login")
  @HttpCode(200)
  @UseGuards(AuthOriginGuard)
  @Header("Cache-Control", "no-store")
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(LoginInput)) input: LoginInput,
  ) {
    const result = await this.auth.login(input);
    setRefreshCookie(response, result.refreshToken, result.lifetimeMs);
    return apiOk(request, result.auth);
  }

  @Post("refresh")
  @HttpCode(200)
  @UseGuards(AuthOriginGuard)
  @Header("Cache-Control", "no-store")
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.refresh(refreshCookie(request));
    if (!result) {
      response.clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS);
      throw apiError(401, ERROR_CODES.REFRESH_INVALID, "登录已失效，请重新登录");
    }
    setRefreshCookie(response, result.refreshToken, result.lifetimeMs);
    return apiOk(request, AccessTokenResult.parse(result.access));
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(AuthOriginGuard, AuthGuard)
  @Header("Cache-Control", "no-store")
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(LogoutInput.default({ allDevices: false }))) input: LogoutInput,
  ): Promise<void> {
    await this.auth.logout(request.auth, refreshCookie(request), input.allDevices);
    response.clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  @Header("Cache-Control", "no-store")
  async me(@Req() request: AuthenticatedRequest) {
    const { userId, userUuid } = request.auth;
    return apiOk(request, await this.auth.me(userId, userUuid));
  }
}
