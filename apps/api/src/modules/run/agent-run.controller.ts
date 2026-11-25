import {
  ActiveRun,
  AnswerCardInput,
  CancelResult,
  Id,
  IdempotencyKey,
  LastEventId,
  SendMessageInput,
  SSE_DONE,
} from "@arch-flow/shared";
import {
  Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards,
  createParamDecorator, type ExecutionContext,
} from "@nestjs/common";
import type { Response } from "express";
import { apiOk, getTraceId } from "../../common/api-response.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { IdempotencyHeader } from "../workspace/workspace-http.js";
import { acceptedRun, AgentRunService } from "./agent-run.service.js";

const HEARTBEAT_MS = 15_000;
const MAX_WRITE_BUFFER_BYTES = 1024 * 1024;

const CursorHeader = createParamDecorator(
  (_input: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().headers["last-event-id"],
);

@Controller()
@UseGuards(AuthGuard)
export class AgentRunController {
  constructor(private readonly service: AgentRunService) {}

  @Post("conversations/:conversationId/messages")
  @HttpCode(202)
  async send(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", new ZodValidationPipe(Id)) conversationId: string,
    @Body(new ZodValidationPipe(SendMessageInput)) input: SendMessageInput,
    @IdempotencyHeader(new ZodValidationPipe(IdempotencyKey)) key: string,
  ) {
    const ownerId = request.auth.userUuid;
    const run = await this.service.accept(ownerId, conversationId, input, key, getTraceId(request));
    this.service.dispatch(ownerId, run);
    return apiOk(request, acceptedRun(run));
  }

  @Post("conversations/:conversationId/messages/:messageId/answer")
  @HttpCode(202)
  async answer(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", new ZodValidationPipe(Id)) conversationId: string,
    @Param("messageId", new ZodValidationPipe(Id)) messageId: string,
    @Body(new ZodValidationPipe(AnswerCardInput)) input: AnswerCardInput,
    @IdempotencyHeader(new ZodValidationPipe(IdempotencyKey)) key: string,
  ) {
    const ownerId = request.auth.userUuid;
    const run = await this.service.answerCard(ownerId, conversationId, messageId, input, key);
    this.service.dispatch(ownerId, run);
    return apiOk(request, acceptedRun(run));
  }

  @Get("conversations/:conversationId/run")
  async active(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", new ZodValidationPipe(Id)) conversationId: string,
  ) {
    return apiOk(request, ActiveRun.parse(await this.service.active(request.auth.userUuid, conversationId)));
  }

  @Get("runs/:runId")
  async status(
    @Req() request: AuthenticatedRequest,
    @Param("runId", new ZodValidationPipe(Id)) runId: string,
  ) {
    return apiOk(request, (await this.service.snapshot(request.auth.userUuid, runId)).run);
  }

  @Post("runs/:runId/cancel")
  @HttpCode(202)
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param("runId", new ZodValidationPipe(Id)) runId: string,
  ) {
    const run = await this.service.cancel(request.auth.userUuid, runId);
    return apiOk(request, CancelResult.parse({ runId: run.id, status: run.status }));
  }

  @Get("runs/:runId/stream")
  async stream(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Param("runId", new ZodValidationPipe(Id)) runId: string,
    @CursorHeader(new ZodValidationPipe(LastEventId)) cursor: number | undefined,
  ) {
    const snapshot = await this.service.snapshot(request.auth.userUuid, runId);
    if (response.destroyed) return;

    const write = (data: string) => {
      if (response.writableEnded || response.destroyed) return false;
      if (response.writableLength > MAX_WRITE_BUFFER_BYTES) {
        response.destroy();
        return false;
      }
      response.write(data);
      return true;
    };
    const emit: Parameters<typeof this.service.events.subscribe>[3] = ({ id, frame }) => {
      const data = frame === SSE_DONE ? frame : JSON.stringify(frame);
      if (write(`id: ${id}\ndata: ${data}\n\n`) && (frame === SSE_DONE || frame.type === "interrupt")) {
        response.end();
      }
    };
    const { backlog, unsubscribe } = this.service.events.subscribe(snapshot, getTraceId(request), cursor, emit);
    const heartbeat = setInterval(() => write(": heartbeat\n\n"), HEARTBEAT_MS);
    heartbeat.unref();
    response.once("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    response.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    for (const event of backlog) emit(event);
  }
}
