"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Conversation, CreateConversationInput } from "@arch-flow/shared";
import { FORMAL_API_ENABLED, apiPath, requestApi } from "@/lib/api-client";
import { cacheCreatedConversation } from "@/lib/cache-created-conversation";

type CreateConversationVariables = CreateConversationInput & {
  projectId: string;
};

/** 在项目下新建会话，并进入对应的空白画布。 */
export const useCreateConversation = () => {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation<Conversation, Error, CreateConversationVariables>({
    mutationFn: ({ projectId, ...input }) =>
      requestApi<Conversation>(
        apiPath(`/projects/${encodeURIComponent(projectId)}/conversations`),
        {
          method: "POST",
          headers: FORMAL_API_ENABLED ? { "Idempotency-Key": crypto.randomUUID() } : undefined,
          body: JSON.stringify(input),
        },
      ),
    onSuccess: (conversation) => {
      cacheCreatedConversation(queryClient, conversation);

      // 会话已写入项目树缓存；跳转由 RSC 负责，不再立即 refetch 项目列表。
      toast.success("已创建新会话");
      router.push(`/workspace?conversationId=${conversation.id}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
};
