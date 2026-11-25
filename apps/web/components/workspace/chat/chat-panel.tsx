"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Square, X } from "lucide-react";
import { toast } from "sonner";
import type {
  LooseGraph,
  Message,
  Page,
  ProjectNode,
  RunStage,
} from "@arch-flow/shared";
import { BrandMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { activeRunQueryKey, projectQueryKey } from "@/lib/query-keys";
import { isRunInProgress } from "@/lib/run-view";
import { useConversation } from "@/hooks/use-conversation";
import { useConversationRun } from "@/hooks/use-conversation-run";
import { useForkConversation } from "@/hooks/use-fork-conversation";
import { useMessages } from "@/hooks/use-messages";
import { DEFAULT_PROJECT_NAME, useCreateProject } from "@/hooks/use-projects";
import {
  prepareChatSubmission,
  type ChatSubmission,
} from "@/hooks/use-send-message";
import { ChatHeader } from "./chat-header";
import { MessageActionDialog } from "./message-action-dialog";
import { MessageActionsMenu } from "./message-actions-menu";
import { MessageCitations } from "./message-citations";
import { MessageGraphDialog } from "./message-graph-dialog";

/** 输入框默认 2 行（48px），最多撑到 4 行（96px）后出现滚动条。 */
const DRAFT_MIN_HEIGHT = 48;
const DRAFT_MAX_HEIGHT = 96;
const SCROLL_FOLLOW_DISTANCE = 80;
const STAGE_LABELS: Record<RunStage, string> = {
  thinking: "正在理解你的请求…",
  searching_knowledge: "正在查项目资料…",
  drafting_graph: "正在准备架构图…",
  finalizing: "正在保存结果…",
};

type GraphReference = {
  conversationId: string;
  messageId: Message["id"];
  label: string;
};

type ComposerDraft = {
  text: string;
  graphReference?: GraphReference;
};

type SubmissionOptions = Pick<ChatSubmission, "interruptId" | "cardMessageId"> & {
  submittedDraft?: string;
};

type MessageAction =
  | { kind: "fork"; sourceMessageId: Message["id"] }
  | { kind: "restore"; snapshot: LooseGraph; baseVersion: number };

const EMPTY_COMPOSER_DRAFT: ComposerDraft = { text: "" };

const showLiveMessage = (saved: Message[], live?: Message) => {
  if (!live || !(live.content || live.metadata || live.graphSnapshot))
    return saved;
  if (!saved.some(({ id }) => live.id === id)) return [...saved, live];
  return saved.map((message) =>
    message.id === live.id
      ? {
          ...live,
          createdAt: message.createdAt,
          metadata: { ...message.metadata, ...live.metadata },
        }
      : message,
  );
};

export const ChatPanel = ({
  conversationId,
  flushCanvasDraft,
  restoreSnapshot,
}: {
  conversationId: string | null;
  flushCanvasDraft: () => Promise<boolean>;
  restoreSnapshot: (snapshot: LooseGraph, baseVersion: number) => Promise<void>;
}) => {
  const [drafts, setDrafts] = useState<
    ReadonlyMap<string | null, ComposerDraft>
  >(() => new Map());
  const { text: draft, graphReference: selectedGraph } =
    drafts.get(conversationId) ?? EMPTY_COMPOSER_DRAFT;
  const visit = useMemo(() => ({ conversationId }), [conversationId]);
  const activeVisit = useRef<typeof visit | null>(visit);
  const submissionVisit = useRef<typeof visit | null>(null);
  const projectCreationKey = useRef<string | null>(null);
  const forkKeys = useRef(new Map<string, string>());
  const [savingVisit, setSavingVisit] = useState<typeof visit>();
  const [messageAction, setMessageAction] = useState<{
    action: MessageAction;
    trigger: HTMLButtonElement | null;
    visit: typeof visit;
  }>();
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyAnchor = useRef<{ row: Element; top: number } | null>(null);
  const followBottom = useRef(true);
  const lastSubmissions = useRef(new Map<string, ChatSubmission>());
  const [composerHeight, setComposerHeight] = useState<number | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();
  const conversation = useConversation(conversationId);
  const {
    latest: messagesQuery,
    messages: savedMessages,
    canLoadEarlier,
    historyStatus,
    loadEarlier,
  } = useMessages(conversationId);
  const generation = useConversationRun(conversationId);
  const createProject = useCreateProject();
  const forkConversation = useForkConversation();
  const currentAction =
    messageAction?.visit === visit ? messageAction : undefined;
  const historyById = useMemo(
    () => new Map(savedMessages.map((message) => [message.id, message])),
    [savedMessages],
  );
  const sendMessage = generation.send;
  const liveMessage =
    generation.phase === "settled" && messagesQuery.data
      ? undefined
      : generation.view?.message;
  const messages = showLiveMessage(savedMessages, liveMessage);
  const runMessage = messages.find(
    ({ id }) => id === generation.handle?.assistantMessageId,
  );
  const suggestionMessage = generation.handle ? runMessage : messages.at(-1);
  const suggestions =
    !generation.handle || generation.status === "succeeded"
      ? (suggestionMessage?.metadata?.suggestedQuestions ?? [])
      : [];
  const isLoading = conversation.isPending || messagesQuery.isPending;
  const isError = conversation.isLoadingError || messagesQuery.isLoadingError;
  const error = conversation.error ?? messagesQuery.error;
  const isRunning = isRunInProgress(generation.status);
  const runCard = runMessage?.metadata?.card;
  const waitingCard =
    generation.status === "waiting_input" && runCard?.status === "pending"
      ? runCard
      : undefined;
  const savingCanvas = savingVisit === visit;
  const isBusy =
    savingCanvas ||
    sendMessage.isPending ||
    createProject.isPending ||
    generation.cancel.isPending;
  const canSubmit =
    generation.hasRunState &&
    !isBusy &&
    !isRunning &&
    (generation.status !== "waiting_input" || Boolean(waitingCard));

  useLayoutEffect(() => {
    activeVisit.current = visit;
    followBottom.current = true;
    return () => {
      activeVisit.current = null;
    };
  }, [visit]);

  useLayoutEffect(() => {
    const anchor = historyAnchor.current;
    if (!anchor) return;

    historyAnchor.current = null;
    const scroll = scrollRef.current;
    if (scroll?.contains(anchor.row)) {
      scroll.scrollTop += anchor.row.getBoundingClientRect().top - anchor.top;
    }
  });

  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll && followBottom.current) scroll.scrollTop = scroll.scrollHeight;
  });

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
  }, [draft, conversationId]);

  /**
   * 底部占位盒保留输入框的 2 行基础高度及其他控件；
   * 输入框展开时绝对定位向上溢出，不再挤压上方消息区。
   */
  useEffect(() => {
    const composer = composerRef.current;

    if (!composer) {
      return;
    }

    const syncPlaceholder = () => {
      const textarea = draftRef.current;

      const draftOverflow = textarea
        ? Math.max(0, textarea.offsetHeight - DRAFT_MIN_HEIGHT)
        : 0;

      setComposerHeight(composer.offsetHeight - draftOverflow);
    };

    syncPlaceholder();
    const observer = new ResizeObserver(syncPlaceholder);
    observer.observe(composer);

    return () => observer.disconnect();
  }, []);

  const handleLoadEarlier = () => {
    void loadEarlier(() => {
      const row = scrollRef.current?.querySelector("[data-message-id]");
      if (!row) return;

      followBottom.current = false;
      historyAnchor.current = { row, top: row.getBoundingClientRect().top };
    });
  };

  const closeMessageAction = () => {
    setMessageAction((current) =>
      current === currentAction ? undefined : current,
    );
  };

  const confirmMessageAction = async () => {
    if (!currentAction || !conversationId || activeVisit.current !== visit)
      return;
    const { action } = currentAction;
    if (action.kind === "restore") {
      await restoreSnapshot(action.snapshot, action.baseVersion);
      if (activeVisit.current === visit) toast.success("已恢复快照");
      return;
    }

    const operation = `${conversationId}:${action.sourceMessageId}`;
    const idempotencyKey =
      forkKeys.current.get(operation) ?? crypto.randomUUID();
    forkKeys.current.set(operation, idempotencyKey);
    const forked = await forkConversation.mutateAsync({
      conversationId,
      sourceMessageId: action.sourceMessageId,
      idempotencyKey,
    });
    forkKeys.current.delete(operation);
    if (activeVisit.current === visit) {
      router.push(`/workspace?conversationId=${forked.id}`);
    }
  };

  const renderMessageFooter = ({ id, createdAt }: Message) => {
    const saved = historyById.get(id);
    const baseVersion = conversation.data?.draftVersion;
    const hasActions =
      conversationId &&
      saved &&
      (saved.role === "user" ||
        (saved.role === "assistant" &&
          (saved.content || saved.metadata || saved.graphSnapshot)));

    return (
      <div className="mt-1 flex items-center gap-1">
        <time
          dateTime={createdAt}
          className="text-[10px] text-muted-foreground/70"
        >
          {createdAt.slice(11, 16)}
        </time>
        {hasActions && (
          <MessageActionsMenu
            snapshot={saved.graphSnapshot ?? null}
            disabled={forkConversation.isPending}
            onFork={(trigger) =>
              setMessageAction({
                visit,
                trigger,
                action: { kind: "fork", sourceMessageId: saved.id },
              })
            }
            onRestore={
              baseVersion === undefined
                ? undefined
                : (snapshot, trigger) =>
                    setMessageAction({
                      visit,
                      trigger,
                      action: { kind: "restore", snapshot, baseVersion },
                    })
            }
          />
        )}
      </div>
    );
  };

  const updateDraft = (
    targetId: string | null,
    update: (draft: ComposerDraft) => ComposerDraft,
  ) => {
    setDrafts((current) => {
      const previous = current.get(targetId) ?? EMPTY_COMPOSER_DRAFT;
      const next = update(previous);
      if (
        next.text === previous.text &&
        next.graphReference === previous.graphReference
      ) {
        return current;
      }

      const updated = new Map(current);
      if (next.text || next.graphReference) updated.set(targetId, next);
      else updated.delete(targetId);
      return updated;
    });
  };

  const setDraft = (text: string) =>
    updateDraft(conversationId, (current) => ({ ...current, text }));

  const toggleGraphReference = (message: Message) => {
    if (!conversationId || !canSubmit || submissionVisit.current === visit)
      return;

    const time = message.createdAt.slice(11, 19);
    const excerpt = message.content.trim().split(/\r?\n/, 1).at(0);
    const label = excerpt ? `${time} ${excerpt}` : time;
    updateDraft(conversationId, (current) => ({
      ...current,
      graphReference:
        current.graphReference?.messageId === message.id
          ? undefined
          : { conversationId, messageId: message.id, label },
    }));
    draftRef.current?.focus();
  };

  const send = async (
    targetId: string,
    content: string,
    { interruptId, cardMessageId, submittedDraft }: SubmissionOptions = {},
  ) => {
    const variables = prepareChatSubmission(
      { conversationId: targetId, content, interruptId, cardMessageId },
      lastSubmissions.current.get(targetId) ?? null,
      selectedGraph,
    );
    lastSubmissions.current.set(targetId, variables);
    followBottom.current = true;
    try {
      await sendMessage.mutateAsync(variables);
      lastSubmissions.current.delete(targetId);
      updateDraft(targetId, (current) => ({
        text: current.text === submittedDraft ? "" : current.text,
        graphReference:
          current.graphReference === selectedGraph
            ? undefined
            : current.graphReference,
      }));
    } catch (error) {
      if (
        activeVisit.current === visit ||
        activeVisit.current?.conversationId === targetId
      ) {
        toast.error(
          error instanceof Error ? error.message : "发送失败，请重试。",
        );
      }
    }
  };

  const runSubmission = async (work: () => Promise<void>) => {
    if (submissionVisit.current === visit) return;
    submissionVisit.current = visit;
    try {
      await work();
    } finally {
      if (submissionVisit.current === visit) submissionVisit.current = null;
    }
  };

  const submit = (content: string, options?: SubmissionOptions) => {
    if (!conversationId || !canSubmit) return;

    void runSubmission(async () => {
      setSavingVisit(visit);
      followBottom.current = true;
      let saved = false;
      try {
        saved = await flushCanvasDraft();
      } catch {
        saved = false;
      } finally {
        setSavingVisit((current) => (current === visit ? undefined : current));
      }

      if (activeVisit.current !== visit) return;
      if (!saved) {
        toast.error("请先完成右侧画布的保存，再发送消息。");
        return;
      }
      const runState = queryClient.getQueryState(
        activeRunQueryKey(conversationId),
      );
      if (
        runState?.status !== "success" ||
        runState.fetchStatus === "fetching"
      ) {
        toast.info("请等会话状态恢复后重新发送。");
        return;
      }
      await send(conversationId, content, options);
    });
  };

  const handleSend = () => {
    const content = draft.trim();
    if (!content || !canSubmit) return;

    if (conversationId) {
      submit(content, { interruptId: waitingCard?.id, submittedDraft: draft });
      return;
    }

    const cachedProjects =
      queryClient.getQueryData<Page<ProjectNode>>(projectQueryKey);

    if (cachedProjects === undefined) {
      toast.info("项目数据加载中，请稍后再试");
      return;
    }

    if (cachedProjects.items.length > 0 && !projectCreationKey.current) {
      toast.info("请先从左侧选择一个会话");
      return;
    }

    /** 边界：项目数为 0 时，发送会话消息前先创建项目与首个会话。 */
    void runSubmission(async () => {
      projectCreationKey.current ??= crypto.randomUUID();
      try {
        const project = await createProject.mutateAsync({
          name: DEFAULT_PROJECT_NAME,
          idempotencyKey: projectCreationKey.current,
        });
        projectCreationKey.current = null;
        if (activeVisit.current !== visit) return;

        const nextConversationId = project.lastActiveConversationId;
        if (!nextConversationId) {
          toast.error("项目已创建，但没有可用的会话");
          return;
        }

        setDrafts((current) => {
          const next = new Map(current);
          next.delete(null);
          if (!next.has(nextConversationId)) {
            next.set(nextConversationId, current.get(null) ?? { text: draft });
          }
          return next;
        });
        router.replace(`/workspace?conversationId=${nextConversationId}`);
        await send(nextConversationId, content, { submittedDraft: draft });
      } catch (error) {
        if (activeVisit.current === visit) {
          toast.error(
            error instanceof Error ? error.message : "创建项目失败，请重试。",
          );
        }
      }
    });
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col border-r border-border bg-background">
      <ChatHeader conversation={conversation.data ?? null} />

      <div
        ref={scrollRef}
        className="arch-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-6"
        onScroll={({ currentTarget }) => {
          followBottom.current =
            currentTarget.scrollHeight -
              currentTarget.scrollTop -
              currentTarget.clientHeight <
            SCROLL_FOLLOW_DISTANCE;
        }}
      >
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

        {conversation.data &&
          !isLoading &&
          !isError &&
          messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <BrandMark className="size-8 opacity-60" />
              <p className="mt-4 text-sm font-medium">从一个约束开始</p>
              <p className="mt-1 max-w-[280px] text-[11px] leading-5 text-muted-foreground">
                例如：团队 3 人、预算有限、需要在单机部署。描述你的场景，Agent
                会追问约束并生成架构。
              </p>
            </div>
          )}

        {(canLoadEarlier || historyStatus === "loaded") && (
          <div className="flex flex-col items-center gap-2">
            {canLoadEarlier ? (
              <Button
                variant="outline"
                size="sm"
                aria-disabled={historyStatus === "loading"}
                aria-busy={historyStatus === "loading"}
                onClick={handleLoadEarlier}
              >
                {historyStatus === "loading" && (
                  <Loader2
                    data-icon="inline-start"
                    className="animate-spin"
                    aria-hidden
                  />
                )}
                加载更早的消息
              </Button>
            ) : (
              <p role="status" className="text-xs text-muted-foreground">
                已加载全部消息
              </p>
            )}
            {historyStatus === "error" && (
              <p role="alert" className="text-xs text-muted-foreground">
                更早的消息加载失败，请重试。
              </p>
            )}
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <div
              key={message.id}
              data-message-id={message.id}
              className="mt-6 flex flex-col items-end"
            >
              <div className="max-w-[88%] rounded-xl rounded-tr-sm bg-secondary px-4 py-3 text-[13px] leading-6 text-secondary-foreground">
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
              {renderMessageFooter(message)}
            </div>
          ) : (
            <div
              key={message.id}
              data-message-id={message.id}
              className="mt-6 flex items-start gap-3"
            >
              <BrandMark className="mt-0.5 size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                {message.content &&
                  message.content !== message.metadata?.card?.title && (
                    <p className="whitespace-pre-wrap text-[13px] leading-6">
                      {message.content}
                    </p>
                  )}
                {Boolean(message.metadata?.citations?.length) && (
                  <MessageCitations citations={message.metadata?.citations ?? []} />
                )}
                {message.metadata?.card && (
                  <div className="mt-2 flex flex-col items-start gap-2 rounded-md border border-border p-3">
                    <p className="text-sm">{message.metadata.card.title}</p>
                    {message.metadata.card.status === "answered" ? (
                      <p className="text-xs text-muted-foreground">
                        已回答 ·{" "}
                        {message.metadata.card.answer?.values.join("、")}
                      </p>
                    ) : message.metadata.card.status === "pending" &&
                      waitingCard?.id === message.metadata.card.id ? (
                      <div className="flex flex-wrap gap-2">
                        {waitingCard.options.map(({ value, label }) => (
                          <Button
                            key={value}
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!canSubmit}
                            onClick={() => submit(value, {
                              interruptId: waitingCard.id,
                              cardMessageId: message.id,
                            })}
                          >
                            {label}
                          </Button>
                        ))}
                        {waitingCard.options.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            在下方输入你的回答。
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
                {message.graphSnapshot && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <MessageGraphDialog graph={message.graphSnapshot} />
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        selectedGraph?.messageId === message.id
                          ? "secondary"
                          : "outline"
                      }
                      aria-pressed={selectedGraph?.messageId === message.id}
                      disabled={!conversationId || !canSubmit}
                      onClick={() => toggleGraphReference(message)}
                    >
                      用这张图提问
                    </Button>
                  </div>
                )}
                {renderMessageFooter(message)}
              </div>
            </div>
          ),
        )}

        {(savingCanvas || sendMessage.isPending || isRunning) &&
          generation.phase !== "unavailable" && (
            <p
              role="status"
              className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"
            >
              <Loader2 className="size-3.5 animate-spin" />
              {savingCanvas
                ? "正在保存画布…"
                : generation.phase === "reconnecting" ||
                    generation.phase === "polling"
                  ? "正在恢复连接…"
                  : generation.view?.stage
                    ? STAGE_LABELS[generation.view.stage]
                    : "正在处理消息…"}
            </p>
          )}

        {generation.phase === "unavailable" || generation.error ? (
          <div
            className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"
            role="status"
          >
            暂时无法同步对话。
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={generation.retry}
            >
              重连
            </Button>
          </div>
        ) : generation.status === "failed" ||
          generation.status === "canceled" ? (
          <p role="status" className="mt-4 text-xs text-muted-foreground">
            {generation.status === "canceled"
              ? "已停止生成"
              : (generation.view?.error ?? "生成失败，请重试。")}
          </p>
        ) : null}

        {suggestions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="推荐问题">
            {suggestions.map((question) => (
              <Button
                key={question}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(question);
                  draftRef.current?.focus();
                }}
              >
                {question}
              </Button>
            ))}
          </div>
        )}
      </div>

      {currentAction && (
        <MessageActionDialog
          action={currentAction.action.kind}
          trigger={currentAction.trigger}
          onClose={closeMessageAction}
          onConfirm={confirmMessageAction}
        />
      )}

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
            <div className="flex" aria-live="polite">
              {selectedGraph && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mb-2 max-w-full"
                  aria-label="移除历史图引用"
                  title={selectedGraph.label}
                  disabled={savingCanvas || sendMessage.isPending}
                  onClick={() => {
                    if (submissionVisit.current === visit) return;
                    updateDraft(conversationId, (current) => ({
                      ...current,
                      graphReference: undefined,
                    }));
                    draftRef.current?.focus();
                  }}
                >
                  <span className="truncate">
                    引用历史图 · {selectedGraph.label}
                  </span>
                  <X
                    size={14}
                    className="shrink-0"
                    data-icon="inline-end"
                    aria-hidden
                  />
                </Button>
              )}
            </div>
            <textarea
              ref={draftRef}
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="描述你的技术约束或回答问题..."
              className="arch-scrollbar w-full resize-none overflow-y-auto bg-transparent text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              {generation.handle &&
                (isRunning || generation.status === "waiting_input") && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={generation.cancel.isPending}
                    onClick={() => {
                      if (!generation.handle) return;
                      generation.cancel.mutate(generation.handle.runId, {
                        onError: (error) => toast.error(error.message),
                      });
                    }}
                  >
                    <Square data-icon="inline-start" />
                    停止生成
                  </Button>
                )}
              <button
                type="button"
                aria-label="发送消息"
                onClick={handleSend}
                disabled={!draft.trim() || !canSubmit}
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
