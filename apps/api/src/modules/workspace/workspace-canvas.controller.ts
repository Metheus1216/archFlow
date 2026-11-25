import {
  AssetDetailQuery,
  AssetInput,
  AssetListQuery,
  ForkInput,
  Id,
  IdempotencyKey,
  SaveDraftInput,
} from "@arch-flow/shared";
import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { apiOk, getTraceId } from "../../common/api-response.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { WorkspaceCanvasService } from "./workspace-canvas.service.js";
import { IdempotencyHeader, respondToCreate } from "./workspace-http.js";

@Controller()
@UseGuards(AuthGuard)
export class WorkspaceCanvasController {
  constructor(private readonly canvas: WorkspaceCanvasService) {}

  @Put("conversations/:conversationId/draft")
  async saveDraft(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", new ZodValidationPipe(Id)) conversationId: string,
    @Body(new ZodValidationPipe(SaveDraftInput)) input: SaveDraftInput,
  ) {
    return apiOk(request, await this.canvas.saveDraft(request.auth.userId, conversationId, input));
  }

  @Get("projects/:projectId/assets")
  async listAssets(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ZodValidationPipe(Id)) projectId: string,
    @Query(new ZodValidationPipe(AssetListQuery)) pagination: AssetListQuery,
  ) {
    return apiOk(request, await this.canvas.listAssets(request.auth.userId, projectId, pagination));
  }

  @Post("projects/:projectId/assets")
  saveAsset(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ZodValidationPipe(Id)) projectId: string,
    @Body(new ZodValidationPipe(AssetInput)) input: AssetInput,
    @IdempotencyHeader(new ZodValidationPipe(IdempotencyKey)) key: string,
  ) {
    return respondToCreate(request, () => this.canvas.saveAsset(request.auth.userId, projectId, input, {
      key,
      traceId: getTraceId(request),
    }));
  }

  @Get("projects/:projectId/assets/:assetId")
  async getAsset(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ZodValidationPipe(Id)) projectId: string,
    @Param("assetId", new ZodValidationPipe(Id)) assetId: string,
    @Query(new ZodValidationPipe(AssetDetailQuery)) query: AssetDetailQuery,
  ) {
    return apiOk(request, await this.canvas.getAsset(request.auth.userId, projectId, assetId, query.includeGraph));
  }

  @Post("conversations/:conversationId/fork")
  forkConversation(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", new ZodValidationPipe(Id)) conversationId: string,
    @Body(new ZodValidationPipe(ForkInput)) input: ForkInput,
    @IdempotencyHeader(new ZodValidationPipe(IdempotencyKey)) key: string,
  ) {
    return respondToCreate(request, () => this.canvas.forkConversation(request.auth.userId, conversationId, input, {
      key,
      traceId: getTraceId(request),
    }));
  }
}
