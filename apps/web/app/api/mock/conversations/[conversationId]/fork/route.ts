import { ERROR_CODES, ForkInput, ForkResult, Id, IdempotencyKey } from "@arch-flow/shared";
import { forkConversation } from "@/lib/mock-db";
import { mockError, mockOk } from "@/lib/mock-response";
import { handleMockRunRoute } from "@/lib/mock-run-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ conversationId: string }> };

export const POST = async (request: Request, { params }: RouteContext) =>
  handleMockRunRoute(request, async (userId) => {
    const conversationId = Id.parse((await params).conversationId);
    const key = IdempotencyKey.safeParse(request.headers.get("Idempotency-Key"));
    if (!key.success) {
      return mockError(422, ERROR_CODES.VALIDATION_FAILED, "缺少有效的 Idempotency-Key");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return mockError(400, ERROR_CODES.BAD_REQUEST, "请求不是合法的 JSON");
    }

    const input = ForkInput.parse(body);
    const { result, traceId } = await forkConversation(userId, conversationId, input, key.data);
    return mockOk(ForkResult, result, 201, traceId);
  });
