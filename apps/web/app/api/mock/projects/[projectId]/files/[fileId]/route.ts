import { ERROR_CODES } from "@arch-flow/shared";
import { deleteFile } from "@/lib/mock-db";
import {
  MOCK_ENABLED,
  mockDisabled,
  mockError,
  mockNoContent,
} from "@/lib/mock-response";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string; fileId: string }>;
};

export const DELETE = async (_request: Request, context: RouteContext) => {
  if (!MOCK_ENABLED) {
    return mockDisabled();
  }

  const { projectId, fileId } = await context.params;
  const deleted = await deleteFile(projectId, fileId);

  if (!deleted) {
    return mockError(404, ERROR_CODES.FILE_NOT_FOUND, "文件不存在");
  }

  return mockNoContent();
};
