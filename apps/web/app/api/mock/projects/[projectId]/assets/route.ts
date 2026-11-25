import {
  AssetInput,
  AssetMeta,
  ERROR_CODES,
  Id,
  IdempotencyKey,
  mapGraphError,
} from "@arch-flow/shared";
import { createAsset } from "@/lib/mock-db";
import { mockError, mockOk, toFieldErrors } from "@/lib/mock-response";
import { handleMockRunRoute } from "@/lib/mock-run-route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ projectId: string }> };

export const POST = async (request: Request, { params }: RouteContext) =>
  handleMockRunRoute(request, async (userId) => {
    const projectId = Id.parse((await params).projectId);
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

    const input = AssetInput.safeParse(body);
    if (!input.success) {
      const fields = toFieldErrors(input.error);
      if (input.error.issues.some(({ path }) => path[0] === "graph" || path[0] === "layout")) {
        const { httpStatus, errorCode } = mapGraphError(input.error);
        return mockError(
          httpStatus,
          errorCode,
          httpStatus === 413 ? "画布数据过大" : "画布数据不合法",
          httpStatus === 422 ? fields : undefined,
        );
      }
      return mockError(422, ERROR_CODES.VALIDATION_FAILED, "请求参数不合法", fields);
    }

    const result = await createAsset(userId, projectId, input.data, key.data);
    if (result.status === "project_not_found") {
      return mockError(404, ERROR_CODES.PROJECT_NOT_FOUND, "项目不存在");
    }
    if (result.status === "key_reused") {
      return mockError(422, ERROR_CODES.IDEMPOTENCY_KEY_REUSED, "保存请求已提交，请重新操作");
    }
    return mockOk(AssetMeta, result.asset, 201, result.traceId);
  });
