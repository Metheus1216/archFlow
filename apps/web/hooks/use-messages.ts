"use client";

import { useQuery } from "@tanstack/react-query";
import { Message, PageSchema } from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";

export const messagesQueryKey = (conversationId: string) =>
  ["messages", conversationId] as const;

const messagePageSchema = PageSchema(Message);

/** §4.4：mock 阶段一次取最新的 50 条（PaginationQuery 上限）。 */
export const useMessages = (conversationId: string | null) =>
  useQuery({
    queryKey: messagesQueryKey(conversationId ?? "none"),
    queryFn: async () => {
      if (!conversationId) {
        throw new Error("缺少 conversationId");
      }

      return requestApi(
        `/api/mock/conversations/${conversationId}/messages?limit=50&direction=backward`,
        messagePageSchema,
      );
    },
    enabled: conversationId !== null,
  });
