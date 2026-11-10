import { z } from "zod";
import {
  Conversation,
  ERROR_CODES,
  UpdateConversationInput,
} from "@arch-flow/shared";
import {
  deleteConversation,
  getConversation,
  renameConversation,
} from "@/lib/mock-db";
import {
  MOCK_ENABLED,
  mockDisabled,
  mockError,
  mockNoContent,
  mockOk,
  toFieldErrors,
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
  const conversation = await getConversation(conversationId);

  if (!conversation) {
    return mockError(
      404,
      ERROR_CODES.CONVERSATION_NOT_FOUND,
      "会话不存在",
    );
  }

  return mockOk(Conversation, conversation);
};

export const PATCH = async (request: Request, context: RouteContext) => {
  if (!MOCK_ENABLED) {
    return mockDisabled();
  }

  try {
    const { conversationId } = await context.params;
    const body: unknown = await request.json();
    const input = UpdateConversationInput.parse(body);
    const conversation = await renameConversation(conversationId, input.title);

    if (!conversation) {
      return mockError(
        404,
        ERROR_CODES.CONVERSATION_NOT_FOUND,
        "会话不存在",
      );
    }

    return mockOk(Conversation, conversation);
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
