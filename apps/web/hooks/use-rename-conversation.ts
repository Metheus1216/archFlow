"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Conversation,
  type Page,
  type ProjectNode,
} from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";
import { conversationQueryKey } from "./use-conversation";
import { projectQueryKey } from "./use-projects";

type RenameConversationVariables = {
  conversationId: string;
  title: string;
};

/** 重命名会话：成功后同步会话详情与左侧项目树缓存。 */
export const useRenameConversation = () => {
  const queryClient = useQueryClient();

  return useMutation<Conversation, Error, RenameConversationVariables>({
    mutationFn: ({ conversationId, title }) =>
      requestApi(
        `/api/mock/conversations/${conversationId}`,
        Conversation,
        {
          method: "PATCH",
          body: JSON.stringify({ title }),
        },
      ),
    onSuccess: (conversation) => {
      queryClient.setQueryData<Page<ProjectNode>>(projectQueryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((project) =>
                project.id === conversation.projectId
                  ? {
                      ...project,
                      conversations: project.conversations.map((item) =>
                        item.id === conversation.id
                          ? {
                              ...item,
                              title: conversation.title,
                              updatedAt: conversation.updatedAt,
                            }
                          : item,
                      ),
                    }
                  : project,
              ),
            }
          : current,
      );

      queryClient.setQueryData<Conversation>(
        conversationQueryKey(conversation.id),
        conversation,
      );

      toast.success("会话已重命名");
      void queryClient.invalidateQueries({ queryKey: projectQueryKey });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
};
