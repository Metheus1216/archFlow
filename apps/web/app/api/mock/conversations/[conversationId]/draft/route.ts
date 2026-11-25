import {
  ERROR_CODES,
  Id,
  mapGraphError,
  SaveDraftInput,
  SaveDraftResult,
} from "@arch-flow/shared";
import { saveConversationDraft } from "@/lib/mock-db";
import { mockError, mockOk, toFieldErrors } from "@/lib/mock-response";
import { handleMockRunRoute } from "@/lib/mock-run-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ conversationId: string }> };

export const PUT = async (request: Request, { params }: RouteContext) =>
  handleMockRunRoute(request, async (userId) => {
    const conversationId = Id.parse((await params).conversationId);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return mockError(400, ERROR_CODES.BAD_REQUEST, "请求不是合法的 JSON");
    }

    const input = SaveDraftInput.safeParse(body);
    if (!input.success) {
      const fields = toFieldErrors(input.error);
      const hasGraphIssue = input.error.issues.some(
        ({ path }) => path[0] === "graph" || path[0] === "layout",
      );
      if (hasGraphIssue) {
        const { httpStatus, errorCode } = mapGraphError(input.error);
        return mockError(
          httpStatus,
          errorCode,
          httpStatus === 413 ? "画布数据过大" : "画布数据不合法",
          httpStatus === 422 ? fields : undefined,
        );
      }
      return mockError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        "请求参数不合法",
        fields,
      );
    }

    const result = await saveConversationDraft(
      userId,
      conversationId,
      input.data,
    );
    return mockOk(SaveDraftResult, result);
  });
