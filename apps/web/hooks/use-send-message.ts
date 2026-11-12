"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Conversation,
  Message,
  MockSendMessageResult,
  Page,
  ProjectNode,
  SendMessageInput,
} from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";
import {
  conversationQueryKey,
  messagesQueryKey,
  projectQueryKey,
} from "@/lib/query-keys";

type SendMessageVariables = SendMessageInput & {
  conversationId: string;
};

/** 用服务端返回的消息同步会话摘要，避免再发一次 GET。 */
const patchConversation = (
  conversation: Conversation,
  message: Message,
): Conversation => ({
  ...conversation,
  messageCount: conversation.messageCount + 1,
  lastMessage: {
    id: message.id,
    role: message.role,
    contentPreview: message.content.slice(0, 80),
    createdAt: message.createdAt,
  },
  updatedAt: message.createdAt,
});

/** 同步侧边栏里的会话摘要，并按更新时间把当前会话排到最前。 */
const patchProject = (
  project: ProjectNode,
  conversationId: string,
  message: Message,
): ProjectNode => {
  const exists = project.conversations.some(
    (conversation) => conversation.id === conversationId,
  );

  if (!exists) {
    return project;
  }

  const conversations = project.conversations
    .map((conversation) =>
      conversation.id === conversationId
        ? { ...conversation, updatedAt: message.createdAt }
        : conversation,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    ...project,
    lastActiveConversationId: conversationId,
    conversations,
  };
};

export const useSendMessage = () => {
  const queryClient = useQueryClient();

  return useMutation<MockSendMessageResult, Error, SendMessageVariables>({
    mutationFn: async ({ conversationId, ...input }) =>
      requestApi<MockSendMessageResult>(
        `/api/mock/conversations/${conversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      ),
    /**
     * POST 已经返回了权威消息，三份缓存都在本地增量更新；
     * 不再 invalidate，否则发一条消息会立刻多打 3 个 GET。
     */
    onSuccess: ({ message }, { conversationId }) => {
      queryClient.setQueryData<Page<Message>>(
        messagesQueryKey(conversationId),
        (current) =>
          current
            ? { ...current, items: [...current.items, message] }
            : current,
      );

      queryClient.setQueryData<Conversation>(
        conversationQueryKey(conversationId),
        (current) => (current ? patchConversation(current, message) : current),
      );

      queryClient.setQueryData<Page<ProjectNode>>(
        projectQueryKey,
        (current) =>
          current
            ? {
                ...current,
                items: current.items.map((project) =>
                  patchProject(project, conversationId, message),
                ),
              }
            : current,
      );
    },
  });
};
