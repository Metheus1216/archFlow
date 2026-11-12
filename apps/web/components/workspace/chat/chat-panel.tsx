"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import type { Page, ProjectNode } from "@arch-flow/shared";
import { BrandMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { projectQueryKey } from "@/lib/query-keys";
import { useConversation } from "@/hooks/use-conversation";
import { useMessages } from "@/hooks/use-messages";
import {
  DEFAULT_PROJECT_NAME,
  useCreateProject,
} from "@/hooks/use-projects";
import { useSendMessage } from "@/hooks/use-send-message";
import { ChatHeader } from "./chat-header";

/** 输入框默认 2 行（48px），最多撑到 4 行（96px）后出现滚动条。 */
const DRAFT_MIN_HEIGHT = 48;
const DRAFT_MAX_HEIGHT = 96;

const MessageTime = ({ createdAt }: { createdAt: string }) => (
  <p className="mt-1 text-[10px] text-muted-foreground/70">
    {createdAt.slice(11, 16)}
  </p>
);

export const ChatPanel = ({ conversationId }: { conversationId: string | null }) => {
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const conversation = useConversation(conversationId);
  const messagesQuery = useMessages(conversationId);
  const createProject = useCreateProject();
  const sendMessage = useSendMessage();
  const messages = messagesQuery.data?.items ?? [];
  const isLoading = conversation.isPending || messagesQuery.isPending;
  const isError = conversation.isError || messagesQuery.isError;
  const error = conversation.error ?? messagesQuery.error;

  useEffect(() => {
    const textarea = draftRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(
      Math.max(textarea.scrollHeight, DRAFT_MIN_HEIGHT),
      DRAFT_MAX_HEIGHT,
    )}px`;
  }, [draft]);

  /**
   * 底部占位盒高度只在输入框处于 2 行基础高度时测量；
   * 输入框展开时绝对定位向上溢出，不再挤压上方消息区。
   */
  useEffect(() => {
    const composer = composerRef.current;

    if (!composer) {
      return;
    }

    const syncPlaceholder = () => {
      const textarea = draftRef.current;

      if (textarea && textarea.scrollHeight > DRAFT_MIN_HEIGHT) {
        return;
      }

      setComposerHeight(composer.offsetHeight);
    };

    syncPlaceholder();
    const observer = new ResizeObserver(syncPlaceholder);
    observer.observe(composer);

    return () => observer.disconnect();
  }, []);

  const handleSend = () => {
    const content = draft.trim();

    if (!content) {
      return;
    }

    if (conversationId) {
      sendMessage.mutate(
        { conversationId, content },
        {
          onError: (error) => toast.error(error.message),
        },
      );
      setDraft("");
      return;
    }

    const cachedProjects =
      queryClient.getQueryData<Page<ProjectNode>>(projectQueryKey);

    if (cachedProjects === undefined) {
      toast.info("项目数据加载中，请稍后再试");
      return;
    }

    if (cachedProjects.items.length > 0) {
      toast.info("请先从左侧选择一个会话");
      return;
    }

    /** 边界：项目数为 0 时，发送会话消息前先创建项目与首个会话。 */
    setDraft("");
    createProject.mutate(
      { name: DEFAULT_PROJECT_NAME },
      {
        onSuccess: (project) => {
          const nextConversationId = project.lastActiveConversationId;

          if (!nextConversationId) {
            toast.error("项目已创建，但没有可用的会话");
            return;
          }

          router.replace(`/workspace?conversationId=${nextConversationId}`);
          sendMessage.mutate(
            { conversationId: nextConversationId, content },
            {
              onError: (error) => toast.error(error.message),
            },
          );
        },
        onError: (error) => {
          setDraft(content);
          toast.error(error.message);
        },
      },
    );
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col border-r border-border bg-background">
      <ChatHeader conversation={conversation.data ?? null} />

      <div className="arch-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-6">
        {!conversationId && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <BrandMark className="size-8 opacity-60" />
            <p className="mt-4 text-sm font-medium">还没有选择会话</p>
            <p className="mt-1 max-w-[240px] text-[11px] leading-5 text-muted-foreground">
              从左侧项目树选择一个会话，或新建项目开始。
            </p>
          </div>
        )}

        {conversationId && isLoading && (
          <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
            正在加载会话…
          </div>
        )}

        {conversationId && isError && (
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-[11px] text-muted-foreground">
              会话加载失败：{error?.message ?? "未知错误"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void conversation.refetch();
                void messagesQuery.refetch();
              }}
            >
              重试
            </Button>
          </div>
        )}

        {conversation.data && !isLoading && !isError && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <BrandMark className="size-8 opacity-60" />
            <p className="mt-4 text-sm font-medium">从一个约束开始</p>
            <p className="mt-1 max-w-[280px] text-[11px] leading-5 text-muted-foreground">
              例如：团队 3 人、预算有限、需要支持实时协作。描述你的场景，Agent
              会追问约束并生成架构。
            </p>
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="mt-6 flex flex-col items-end">
              <div className="max-w-[88%] rounded-xl rounded-tr-sm bg-secondary px-4 py-3 text-[13px] leading-6 text-secondary-foreground">
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
              <MessageTime createdAt={message.createdAt} />
            </div>
          ) : (
            <div
              key={message.id}
              className="mt-6 flex items-start gap-3"
            >
              <BrandMark className="mt-0.5 size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-[13px] leading-6">
                  {message.content}
                </p>
                <MessageTime createdAt={message.createdAt} />
              </div>
            </div>
          ),
        )}
      </div>

      <div
        className="relative shrink-0"
        style={composerHeight === null ? undefined : { height: composerHeight }}
      >
        <div
          ref={composerRef}
          className={cn(
            "z-10 border-border bg-background p-4 pb-0",
            composerHeight !== null && "absolute inset-x-0 bottom-0",
          )}
        >
          <div className="rounded-xl border border-border bg-card p-3">
            <textarea
              ref={draftRef}
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="描述你的技术约束或回答问题..."
              className="arch-scrollbar w-full resize-none overflow-y-auto bg-transparent text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            <div className="mt-2 flex items-center justify-end">
              
              <button
                type="button"
                aria-label="发送消息"
                onClick={handleSend}
                disabled={!draft.trim()}
                className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
              >
                <Send className="size-3.5" strokeWidth={1.75} />
              </button>
            </div>
          </div>
          <p className="my-1.5 text-center text-[10px] text-muted-foreground">
            ArchFlow 可能会犯错，请在生产使用前审查关键决策。
          </p>
        </div>
      </div>
    </section>
  );
};
