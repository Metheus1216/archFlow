"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AnswerCardInput,
  type ActiveRun,
  MockRunAccepted,
  type MockSendMessageInput,
  RunAccepted,
} from "@arch-flow/shared";
import { FORMAL_API_ENABLED, apiPath, requestApi } from "@/lib/api-client";
import {
  activeRunQueryKey,
  messagesQueryKey,
  projectQueryKey,
} from "@/lib/query-keys";

type SendMessageVariables = MockSendMessageInput & {
  conversationId: string;
  idempotencyKey: string;
  cardMessageId?: string;
};

export type ChatSubmission = Pick<
  SendMessageVariables,
  | "conversationId"
  | "content"
  | "interruptId"
  | "cardMessageId"
  | "graphReferenceMessageId"
  | "idempotencyKey"
>;

export const prepareChatSubmission = (
  {
    conversationId,
    content,
    interruptId,
    cardMessageId,
  }: Omit<ChatSubmission, "graphReferenceMessageId" | "idempotencyKey">,
  previous: ChatSubmission | null,
  reference?: { conversationId: string; messageId: string },
): ChatSubmission => {
  const graphReferenceMessageId =
    reference?.conversationId === conversationId
      ? reference.messageId
      : undefined;
  const isRetry =
    previous?.conversationId === conversationId &&
    previous.content === content &&
    previous.interruptId === interruptId &&
    previous.cardMessageId === cardMessageId &&
    previous.graphReferenceMessageId === graphReferenceMessageId;

  return {
    conversationId,
    content,
    interruptId,
    cardMessageId,
    graphReferenceMessageId,
    idempotencyKey: isRetry ? previous.idempotencyKey : crypto.randomUUID(),
  };
};

export const useSendMessage = (
  onAccepted: (conversationId: string) => void,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      idempotencyKey,
      interruptId,
      cardMessageId,
      ...input
    }: SendMessageVariables) => {
      const messagesPath = `/conversations/${encodeURIComponent(conversationId)}/messages` as const;
      const isCardAnswer = FORMAL_API_ENABLED && cardMessageId !== undefined;
      const target = isCardAnswer
        ? `${messagesPath}/${encodeURIComponent(cardMessageId)}/answer` as const
        : messagesPath;
      const body = isCardAnswer
        ? AnswerCardInput.parse({ cardId: interruptId, values: [input.content] })
        : FORMAL_API_ENABLED ? input : { ...input, interruptId };
      const accepted = await requestApi<unknown>(apiPath(target), {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body),
      });
      return (FORMAL_API_ENABLED ? RunAccepted : MockRunAccepted).parse(accepted);
    },
    onSuccess: async (run, { conversationId }) => {
      const queryKey = activeRunQueryKey(conversationId);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ActiveRun>(queryKey, { run, latest: run });
      onAccepted(conversationId);
      void queryClient.invalidateQueries({
        queryKey: messagesQueryKey(conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: projectQueryKey });
    },
    onError: (_error, { conversationId }) => {
      void queryClient.invalidateQueries({
        queryKey: activeRunQueryKey(conversationId),
      });
    },
  });
};
