"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Conversation, ForkInput, ForkResult } from "@arch-flow/shared";
import { ApiError, apiPath, getAuthState, requestApi } from "@/lib/api-client";
import { cacheCreatedConversation } from "@/lib/cache-created-conversation";
import { projectQueryKey } from "@/lib/query-keys";
import { useAuth } from "./use-auth";

const FORK_TIMEOUT_MS = 12_000;

type ForkSubmission = ForkInput & {
  conversationId: Conversation["id"];
  idempotencyKey: string;
};

export const useForkConversation = () => {
  const ownerId = useAuth().user?.id;
  const queryClient = useQueryClient();
  const isCurrentUser = () =>
    Boolean(ownerId && getAuthState().user?.id === ownerId);

  return useMutation<ForkResult, Error, ForkSubmission>({
    networkMode: "always",
    mutationFn: async ({ conversationId, idempotencyKey, ...input }) => {
      if (!isCurrentUser())
        throw new DOMException("登录会话已切换", "AbortError");

      try {
        return await requestApi<ForkResult>(
          apiPath(`/conversations/${encodeURIComponent(conversationId)}/fork`),
          {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(FORK_TIMEOUT_MS),
          },
        );
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new Error("暂时无法确认新会话是否已创建，请重试。", {
          cause: error,
        });
      }
    },
    onSuccess: async (conversation) => {
      if (!isCurrentUser()) return;
      await queryClient.cancelQueries({
        queryKey: projectQueryKey,
        exact: true,
      });
      if (!isCurrentUser()) return;
      cacheCreatedConversation(queryClient, conversation);
      void queryClient.invalidateQueries({
        queryKey: projectQueryKey,
        exact: true,
      });
    },
  });
};
