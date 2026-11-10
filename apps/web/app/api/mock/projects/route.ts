import { z } from "zod";
import {
  CreateProjectInput,
  ERROR_CODES,
  PageSchema,
  ProjectNode,
} from "@arch-flow/shared";
import { createProject, listProjectNodes } from "@/lib/mock-db";
import {
  MOCK_ENABLED,
  mockDisabled,
  mockError,
  mockOk,
  toFieldErrors,
} from "@/lib/mock-response";

export const dynamic = "force-dynamic";

const projectPageSchema = PageSchema(ProjectNode);

export const GET = async () => {
  if (!MOCK_ENABLED) {
    return mockDisabled();
  }

  const items = await listProjectNodes();

  return mockOk(projectPageSchema, {
    items,
    nextCursor: null,
    hasMore: false,
  });
};

export const POST = async (request: Request) => {
  if (!MOCK_ENABLED) {
    return mockDisabled();
  }

  try {
    const body: unknown = await request.json();
    const input = CreateProjectInput.parse(body);
    const project = await createProject(input);

    return mockOk(ProjectNode, project, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return mockError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "请求参数不合法",
        toFieldErrors(error),
      );
    }

    throw error;
  }
};
