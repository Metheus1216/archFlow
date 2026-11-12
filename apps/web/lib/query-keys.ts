/**
 * 前后端共享的 TanStack Query key。
 *
 * 这里不写 "use client"：Server Component（workspace/page.tsx）
 * 需要用同一份 key 预取并 dehydrate，客户端 hooks 也引用同一份。
 */
export const projectQueryKey = ["projects"] as const;

export const conversationQueryKey = (conversationId: string) =>
  ["conversation", conversationId] as const;

export const messagesQueryKey = (conversationId: string) =>
  ["messages", conversationId] as const;
