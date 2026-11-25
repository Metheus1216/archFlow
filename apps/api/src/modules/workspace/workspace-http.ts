import { ERROR_CODES } from "@arch-flow/shared";
import { HttpException, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { z } from "zod";
import { apiOk } from "../../common/api-response.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";

export const IdempotencyHeader = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => context.switchToHttp()
    .getRequest<AuthenticatedRequest>().headers["idempotency-key"],
);

const IN_PROGRESS_ERROR = z.object({ code: z.literal(ERROR_CODES.IDEMPOTENCY_IN_PROGRESS) });

export const respondToCreate = async <Result>(
  request: AuthenticatedRequest,
  write: () => Promise<{ data: Result; traceId: string }>,
) => {
  try {
    const { data, traceId } = await write();
    return apiOk(request, data, traceId);
  } catch (error) {
    if (error instanceof HttpException && IN_PROGRESS_ERROR.safeParse(error.getResponse()).success) {
      request.res?.setHeader("Retry-After", "1");
    }
    throw error;
  }
};
