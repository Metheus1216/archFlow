"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Conversation,
  type CreateConversationInput,
  type Page,
  type ProjectNode,
} from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";
import { projectQueryKey } from "./use-projects";

type CreateConversationVariables = CreateConversationInput & {
  projectId: string;
};

/** 在项目下新建会话，并进入对应的空白画布。 */
export const useCreateConversation = () => {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation<Conversation, Error, CreateConversationVariables>({
    mutationFn: ({ projectId, ...input }) =>
      requestApi(
        `/api/mock/projects/${projectId}/conversations`,
        Conversation,
        {
          method: "POST",
          body: JSON.stringify(input),
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
                      lastActiveConversationId: conversation.id,
                      conversations: [
                        {
                          id: conversation.id,
                          title: conversation.title,
                          updatedAt: conversation.updatedAt,
                        },
                        ...project.conversations,
                      ],
                    }
                  : project,
              ),
            }
          : current,
      );

      void queryClient.invalidateQueries({ queryKey: projectQueryKey });
      toast.success("已创建新会话");
      router.push(`/workspace?conversationId=${conversation.id}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
};
