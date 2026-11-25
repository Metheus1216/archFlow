import type { QueryClient } from "@tanstack/react-query";
import type { Conversation, Page, ProjectNode } from "@arch-flow/shared";
import { projectQueryKey } from "./query-keys";

export const cacheCreatedConversation = (
  queryClient: QueryClient,
  conversation: Conversation,
) => {
  const projects = queryClient.getQueryData<Page<ProjectNode>>(projectQueryKey);
  if (!projects?.items.some(({ id }) => id === conversation.projectId)) return;

  queryClient.setQueryData<Page<ProjectNode>>(projectQueryKey, {
    ...projects,
    items: projects.items.map((project) =>
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
              ...project.conversations.filter(
                ({ id }) => id !== conversation.id,
              ),
            ],
          }
        : project,
    ),
  });
};
