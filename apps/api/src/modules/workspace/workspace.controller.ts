import {
  CreateConversationInput,
  CreateProjectInput,
  Id,
  IdempotencyKey,
  MessageListQuery,
  PaginationQuery,
  UpdateConversationInput,
  UpdateProjectInput,
} from "@arch-flow/shared";
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { apiOk, getTraceId } from "../../common/api-response.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { IdempotencyHeader, respondToCreate } from "./workspace-http.js";
import { WorkspaceService } from "./workspace.service.js";

@Controller()
@UseGuards(AuthGuard)
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get("projects")
  async listProjects(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(PaginationQuery)) pagination: PaginationQuery,
  ) {
    return apiOk(request, await this.workspace.listProjects(request.auth.userId, pagination));
  }

  @Post("projects")
  createProject(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(CreateProjectInput)) input: CreateProjectInput,
    @IdempotencyHeader(new ZodValidationPipe(IdempotencyKey)) key: string,
  ) {
    return respondToCreate(request, () => this.workspace.createProject(request.auth.userId, input, {
      key,
      traceId: getTraceId(request),
    }));
  }

  @Get("projects/:projectId")
  async getProject(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ZodValidationPipe(Id)) projectId: string,
  ) {
    return apiOk(request, await this.workspace.getProject(request.auth.userId, projectId));
  }

  @Patch("projects/:projectId")
  async updateProject(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ZodValidationPipe(Id)) projectId: string,
    @Body(new ZodValidationPipe(UpdateProjectInput)) input: UpdateProjectInput,
  ) {
    return apiOk(request, await this.workspace.updateProject(request.auth.userId, projectId, input));
  }

  @Get("projects/:projectId/conversations")
  async listConversations(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ZodValidationPipe(Id)) projectId: string,
    @Query(new ZodValidationPipe(PaginationQuery)) pagination: PaginationQuery,
  ) {
    return apiOk(request, await this.workspace.listConversations(request.auth.userId, projectId, pagination));
  }

  @Post("projects/:projectId/conversations")
  createConversation(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ZodValidationPipe(Id)) projectId: string,
    @Body(new ZodValidationPipe(CreateConversationInput.default({}))) input: CreateConversationInput,
    @IdempotencyHeader(new ZodValidationPipe(IdempotencyKey.optional())) key?: string,
  ) {
    return respondToCreate(request, () => this.workspace.createConversation(request.auth.userId, projectId, input, {
      key,
      traceId: getTraceId(request),
    }));
  }

  @Get("conversations/:conversationId")
  async getConversation(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", new ZodValidationPipe(Id)) conversationId: string,
  ) {
    return apiOk(request, await this.workspace.getConversation(request.auth.userId, conversationId));
  }

  @Patch("conversations/:conversationId")
  async renameConversation(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", new ZodValidationPipe(Id)) conversationId: string,
    @Body(new ZodValidationPipe(UpdateConversationInput)) input: UpdateConversationInput,
  ) {
    return apiOk(request, await this.workspace.renameConversation(request.auth.userId, conversationId, input));
  }

  @Get("conversations/:conversationId/messages")
  async listMessages(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", new ZodValidationPipe(Id)) conversationId: string,
    @Query(new ZodValidationPipe(MessageListQuery)) pagination: MessageListQuery,
  ) {
    return apiOk(request, await this.workspace.listMessages(request.auth.userId, conversationId, pagination));
  }
}
