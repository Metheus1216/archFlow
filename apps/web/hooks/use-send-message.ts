"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MockSendMessageResult,
  type ConversationDetail,
  type SendMessageInput,
} from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";
import { conversationQueryKey } from "./use-conversation";
import { projectQueryKey } from "./use-projects";

type SendMessageVariables = SendMessageInput & {
  conversationId: string;
};

export const useSendMessage = () => {
  const queryClient = useQueryClient();

  return useMutation<MockSendMessageResult, Error, SendMessageVariables>({
    mutationFn: async ({ conversationId, ...input }) =>
      requestApi(
        `/api/mock/conversations/${conversationId}/messages`,
        MockSendMessageResult,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      ),
    onSuccess: ({ message }, { conversationId }) => {
      queryClient.setQueryData<ConversationDetail>(
        conversationQueryKey(conversationId),
        (current) =>
          current
            ? { ...current, messages: [...current.messages, message] }
            : current,
      );

      void queryClient.invalidateQueries({
        queryKey: conversationQueryKey(conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: projectQueryKey });
    },
  });
};
