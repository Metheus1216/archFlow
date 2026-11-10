import { ERROR_CODES } from "@arch-flow/shared";
import { deleteProject } from "@/lib/mock-db";
import {
  MOCK_ENABLED,
  mockDisabled,
  mockError,
  mockNoContent,
} from "@/lib/mock-response";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export const DELETE = async (_request: Request, context: RouteContext) => {
  if (!MOCK_ENABLED) {
    return mockDisabled();
  }

  const { projectId } = await context.params;
  const deleted = await deleteProject(projectId);

  if (!deleted) {
    return mockError(404, ERROR_CODES.PROJECT_NOT_FOUND, "项目不存在");
  }

  return mockNoContent();
};
