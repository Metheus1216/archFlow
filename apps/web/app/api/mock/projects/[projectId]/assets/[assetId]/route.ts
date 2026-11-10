import { ERROR_CODES } from "@arch-flow/shared";
import { deleteAsset } from "@/lib/mock-db";
import {
  MOCK_ENABLED,
  mockDisabled,
  mockError,
  mockNoContent,
} from "@/lib/mock-response";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string; assetId: string }>;
};

export const DELETE = async (_request: Request, context: RouteContext) => {
  if (!MOCK_ENABLED) {
    return mockDisabled();
  }

  const { projectId, assetId } = await context.params;
  const deleted = await deleteAsset(projectId, assetId);

  if (!deleted) {
    return mockError(404, ERROR_CODES.ASSET_NOT_FOUND, "资产不存在");
  }

  return mockNoContent();
};
