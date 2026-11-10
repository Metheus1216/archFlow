"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MockSendMessageResult,
  type Message,
  type Page,
  type SendMessageInput,
} from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";
import { conversationQueryKey } from "./use-conversation";
import { messagesQueryKey } from "./use-messages";
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
      queryClient.setQueryData<Page<Message>>(
        messagesQueryKey(conversationId),
        (current) =>
          current
            ? { ...current, items: [...current.items, message] }
            : current,
      );

      void queryClient.invalidateQueries({
        queryKey: conversationQueryKey(conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: messagesQueryKey(conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: projectQueryKey });
    },
  });
};
