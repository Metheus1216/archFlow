import { FILE_UPLOAD_MAX_BYTES, FileIdsQuery, FileListQuery, FileUploadName, FileUploadSize, Id } from "@arch-flow/shared";
import { Controller, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { apiOk } from "../../common/api-response.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { KnowledgeService } from "./knowledge.service.js";

const UploadedProjectFile = z.object({
  originalname: FileUploadName,
  size: FileUploadSize,
  buffer: z.instanceof(Buffer),
});

const MULTIPART_OPTIONS = {
  preservePath: true,
  defParamCharset: "utf8",
  limits: { fileSize: FILE_UPLOAD_MAX_BYTES, files: 1, fields: 0, parts: 1 },
};

@Controller()
@UseGuards(AuthGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Post("projects/:projectId/files")
  @UseInterceptors(FileInterceptor("file", MULTIPART_OPTIONS))
  async upload(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ZodValidationPipe(Id)) projectId: string,
    @UploadedFile(new ZodValidationPipe(UploadedProjectFile)) file: z.infer<typeof UploadedProjectFile>,
  ) {
    return apiOk(request, await this.knowledge.upload(request.auth.userId, projectId, file.originalname, file.buffer));
  }

  @Get("projects/:projectId/files")
  async list(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ZodValidationPipe(Id)) projectId: string,
    @Query(new ZodValidationPipe(FileListQuery)) pagination: FileListQuery,
  ) {
    return apiOk(request, await this.knowledge.list(request.auth.userId, projectId, pagination));
  }

  @Get("projects/:projectId/files/status")
  async statuses(
    @Req() request: AuthenticatedRequest,
    @Param("projectId", new ZodValidationPipe(Id)) projectId: string,
    @Query(new ZodValidationPipe(FileIdsQuery)) query: FileIdsQuery,
  ) {
    return apiOk(request, await this.knowledge.statuses(request.auth.userId, projectId, query));
  }

  @Get("files/:fileId")
  async detail(
    @Req() request: AuthenticatedRequest,
    @Param("fileId", new ZodValidationPipe(Id)) fileId: string,
  ) {
    return apiOk(request, await this.knowledge.detail(request.auth.userId, fileId));
  }
}
