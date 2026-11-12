import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import type { MessageListQuery } from "@arch-flow/shared";
import { WorkspaceView } from "@/components/workspace/workspace-view";
import { getConversation, listMessages } from "@/lib/mock-db";
import {
  conversationQueryKey,
  messagesQueryKey,
} from "@/lib/query-keys";

export const dynamic = "force-dynamic";

type WorkspacePageProps = {
  searchParams: Promise<{ conversationId?: string | string[] }>;
};

const MESSAGE_QUERY: MessageListQuery = {
  limit: 50,
  direction: "backward",
};

const WorkspacePage = async ({ searchParams }: WorkspacePageProps) => {
  const { conversationId } = await searchParams;
  const resolvedConversationId = Array.isArray(conversationId)
    ? (conversationId[0] ?? null)
    : (conversationId ?? null);

  /**
   * 首屏直接服务端取会话与消息，并通过 HydrationBoundary 注入 Query cache；
   * 客户端 useConversation / useMessages 命中缓存，不再发两个 GET。
   */
  const queryClient = new QueryClient();

  if (resolvedConversationId) {
    const [conversation, messages] = await Promise.all([
      getConversation(resolvedConversationId),
      listMessages(resolvedConversationId, MESSAGE_QUERY),
    ]);

    if (conversation) {
      queryClient.setQueryData(
        conversationQueryKey(resolvedConversationId),
        conversation,
      );
    }

    if (messages) {
      queryClient.setQueryData(
        messagesQueryKey(resolvedConversationId),
        messages,
      );
    }
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WorkspaceView conversationId={resolvedConversationId} />
    </HydrationBoundary>
  );
};

export default WorkspacePage;
