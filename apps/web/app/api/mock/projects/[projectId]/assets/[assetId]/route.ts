import { Asset, AssetDetailQuery, AssetMeta, ERROR_CODES, Id } from "@arch-flow/shared";
import { requireMockUser } from "@/lib/mock-auth";
import { deleteAsset, getProjectAsset, toAssetMeta } from "@/lib/mock-db";
import { mockError, mockNoContent, mockOk } from "@/lib/mock-response";
import { handleMockRunRoute } from "@/lib/mock-run-route";
import { readMockGraph } from "@/lib/read-mock-graph";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string; assetId: string }>;
};

export const GET = async (request: Request, { params }: RouteContext) =>
  handleMockRunRoute(request, async (userId) => {
    const { projectId, assetId } = await params;
    const { includeGraph } = AssetDetailQuery.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const asset = await getProjectAsset(userId, Id.parse(projectId), Id.parse(assetId));
    if (!asset) return mockError(404, ERROR_CODES.ASSET_NOT_FOUND, "资产不存在");

    const metadata = toAssetMeta(asset);
    if (!includeGraph) return mockOk(AssetMeta, metadata);

    const graph = readMockGraph(asset.graphData);
    if (!graph) return mockError(422, ERROR_CODES.GRAPH_INVALID, "这份资产没有可用的架构图");
    return mockOk(Asset, { ...metadata, graph, layout: asset.layout });
  });

export const DELETE = async (request: Request, context: RouteContext) => {
  const user = await requireMockUser(request);
  if (user instanceof Response) return user;

  const { projectId, assetId } = await context.params;
  const deleted = await deleteAsset(user.id, projectId, assetId);

  if (!deleted) {
    return mockError(404, ERROR_CODES.ASSET_NOT_FOUND, "资产不存在");
  }

  return mockNoContent();
};
