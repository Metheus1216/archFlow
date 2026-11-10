"use client";

import { useQuery } from "@tanstack/react-query";
import { Conversation } from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";

export const conversationQueryKey = (conversationId: string) =>
  ["conversation", conversationId] as const;

export const useConversation = (conversationId: string | null) =>
  useQuery({
    queryKey: conversationQueryKey(conversationId ?? "none"),
    queryFn: async () => {
      if (!conversationId) {
        throw new Error("缺少 conversationId");
      }

      return requestApi(
        `/api/mock/conversations/${conversationId}`,
        Conversation,
      );
    },
    enabled: conversationId !== null,
  });
