import { ConversationDetail, ERROR_CODES } from "@arch-flow/shared";
import { deleteConversation, getConversationDetail } from "@/lib/mock-db";
import {
  MOCK_ENABLED,
  mockDisabled,
  mockError,
  mockNoContent,
  mockOk,
} from "@/lib/mock-response";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export const GET = async (_request: Request, context: RouteContext) => {
  if (!MOCK_ENABLED) {
    return mockDisabled();
  }

  const { conversationId } = await context.params;
  const detail = await getConversationDetail(conversationId);

  if (!detail) {
    return mockError(
      404,
      ERROR_CODES.CONVERSATION_NOT_FOUND,
      "会话不存在",
    );
  }

  return mockOk(ConversationDetail, detail);
};

export const DELETE = async (_request: Request, context: RouteContext) => {
  if (!MOCK_ENABLED) {
    return mockDisabled();
  }

  const { conversationId } = await context.params;
  const deleted = await deleteConversation(conversationId);

  if (!deleted) {
    return mockError(
      404,
      ERROR_CODES.CONVERSATION_NOT_FOUND,
      "会话不存在",
    );
  }

  return mockNoContent();
};
