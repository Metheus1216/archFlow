import { FileIdsQuery, FileStatusResult, Id } from "@arch-flow/shared";
import { getMockProjectFileStatuses } from "@/lib/mock-project-files";
import { mockOk } from "@/lib/mock-response";
import { handleMockRunRoute } from "@/lib/mock-run-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string }> };

export const GET = (request: Request, { params }: RouteContext) =>
  handleMockRunRoute(request, async (userId) => {
    const projectId = Id.parse((await params).projectId);
    const query = FileIdsQuery.parse({ ids: new URL(request.url).searchParams.get("ids") });
    return mockOk(FileStatusResult, { items: await getMockProjectFileStatuses(userId, projectId, query.ids) });
  });
