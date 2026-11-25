"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActiveRun,
  type CancelResult,
  type Message,
  MockActiveRun,
  type MockRunSnapshot,
  type Page,
  Run,
  type RunAccepted,
} from "@arch-flow/shared";
import { ApiError, FORMAL_API_ENABLED, apiPath, requestApi } from "@/lib/api-client";
import {
  activeRunQueryKey,
  conversationQueryKey,
  messagesQueryKey,
  projectQueryKey,
} from "@/lib/query-keys";
import {
  applyRunFrame,
  applyRunSnapshot,
  createRunView,
  isRunInProgress,
  type RunView,
} from "@/lib/run-view";
import { connectRunStream, waitForRunRetry } from "@/lib/sse-client";
import { getMessagePage } from "./use-messages";
import { useSendMessage } from "./use-send-message";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 100_000;
const POLL_REQUEST_TIMEOUT_MS = 8_000;
const EXTRAS_RECHECK_DELAYS_MS = [500, 1_000, 2_500, 5_000, 7_500, 10_000];

type RunSubscription = { conversationId: string; lastView?: RunView };

type FollowState = {
  handle: RunAccepted;
  subscription?: RunSubscription;
  view: RunView;
  phase:
    | "connecting"
    | "streaming"
    | "reconnecting"
    | "polling"
    | "settled"
    | "unavailable";
};

export const readRunView = async (
  conversationId: string,
  view: RunView,
  signal: AbortSignal,
): Promise<RunView> => {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS)]);
  const path = apiPath(`/runs/${encodeURIComponent(view.runId)}`);
  if (!FORMAL_API_ENABLED) {
    const snapshot = await requestApi<MockRunSnapshot>(path, { signal: requestSignal });
    return applyRunSnapshot(view, snapshot.run, snapshot.assistantMessage, snapshot.stage);
  }

  const run = Run.parse(await requestApi<unknown>(path, { signal: requestSignal }));
  if (run.conversationId !== conversationId) throw new Error("任务快照与当前会话不匹配");
  const page = await getMessagePage(conversationId, requestSignal);
  const assistant = page.items.find(({ id }) => id === run.assistantMessageId);
  return applyRunSnapshot(view, run, assistant);
};

export const useConversationRun = (conversationId: string | null) => {
  const queryClient = useQueryClient();
  const [follow, setFollow] = useState<FollowState>();
  const [requestedSubscription, setRequestedSubscription] =
    useState<RunSubscription>();
  const subscription =
    requestedSubscription?.conversationId === conversationId
      ? requestedSubscription
      : undefined;
  const send = useSendMessage((targetId) =>
    setRequestedSubscription({ conversationId: targetId }),
  );
  const active = useQuery({
    queryKey: activeRunQueryKey(conversationId ?? "none"),
    queryFn: async ({ signal }) => {
      if (!conversationId) throw new Error("缺少 conversationId");
      const result = await requestApi<unknown>(
        apiPath(`/conversations/${encodeURIComponent(conversationId)}/run`),
        { signal },
      );
      return (FORMAL_API_ENABLED ? ActiveRun : MockActiveRun).parse(result);
    },
    enabled: conversationId !== null,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: false,
  });
  const handle = active.data?.run ?? active.data?.latest;

  useEffect(() => {
    if (!conversationId || !handle) return;

    const controller = new AbortController();
    const { signal } = controller;
    const lastView = subscription?.lastView;
    const recovering = lastView?.runId === handle.runId;
    let view = recovering ? lastView : createRunView(handle);
    const publish = (phase: FollowState["phase"]) => {
      if (!signal.aborted) setFollow({ handle, subscription, view, phase });
    };
    const messageKey = messagesQueryKey(conversationId);
    const conversationKey = conversationQueryKey(conversationId);
    const runKey = activeRunQueryKey(conversationId);
    const savedAssistant = () =>
      queryClient
        .getQueryData<Page<Message>>(messageKey)
        ?.items.find(({ id }) => id === handle.assistantMessageId);
    const refreshWorkspace = () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: conversationKey }),
        queryClient.invalidateQueries({ queryKey: projectQueryKey }),
      ]);
    const refreshExtras = async () => {
      if (savedAssistant()?.metadata?.suggestedQuestions) return;
      for (const delay of EXTRAS_RECHECK_DELAYS_MS) {
        await waitForRunRetry(delay, signal);
        const latest = queryClient.getQueryData<ActiveRun>(runKey)?.latest;
        if (signal.aborted || latest?.runId !== handle.runId) return;
        await queryClient.invalidateQueries({ queryKey: messageKey });
        if (savedAssistant()?.metadata?.suggestedQuestions) {
          if (!signal.aborted) void refreshWorkspace();
          return;
        }
      }
    };
    const sync = async () => {
      try {
        await queryClient.invalidateQueries(
          { queryKey: messageKey },
          { throwOnError: true },
        );
        if (signal.aborted) return;
        const saved = savedAssistant();
        publish(saved ? "settled" : "unavailable");
        void refreshWorkspace();
        if (saved && view.status === "succeeded") void refreshExtras();
      } catch {
        publish("unavailable");
      }
    };
    const poll = async () => {
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      publish("polling");
      while (!signal.aborted && Date.now() < deadline) {
        try {
          const snapshot = await readRunView(conversationId, view, signal);
          if (signal.aborted) return;
          view = snapshot;
          if (!isRunInProgress(view.status)) {
            await sync();
            return;
          }
          publish("polling");
        } catch (error) {
          if (
            error instanceof ApiError &&
            /^(TOKEN_|REFRESH_|RUN_NOT_FOUND)/.test(error.code)
          )
            break;
        }
        await waitForRunRetry(POLL_INTERVAL_MS, signal);
      }
      publish("unavailable");
    };
    const start = async () => {
      publish("connecting");
      try {
        if (
          recovering ||
          (!isRunInProgress(handle.status) && handle.status !== "waiting_input")
        ) {
          await poll();
          return;
        }
        const outcome = await connectRunStream(handle.streamUrl, {
          signal,
          onConnectionChange: (connected) =>
            publish(connected ? "streaming" : "reconnecting"),
          onFrame: (frame) => {
            view = applyRunFrame(view, frame);
            publish("streaming");
          },
        });
        if (outcome !== "detached" && !signal.aborted) await sync();
      } catch {
        if (!signal.aborted) await poll();
      }
    };
    const saved = savedAssistant();
    if (!recovering && saved) view = { ...view, message: saved };
    void start();

    return () => controller.abort();
  }, [conversationId, handle, queryClient, subscription]);

  const cancel = useMutation({
    mutationFn: (runId: string) =>
      requestApi<CancelResult>(apiPath(`/runs/${encodeURIComponent(runId)}/cancel`), {
        method: "POST",
      }),
    onSuccess: async () => {
      if (conversationId) {
        await queryClient.invalidateQueries({
          queryKey: activeRunQueryKey(conversationId),
        });
      }
    },
  });

  const current =
    follow?.handle === handle && follow?.subscription === subscription
      ? follow
      : undefined;

  return {
    handle,
    view: current?.view,
    phase: current?.phase,
    status: current?.view.status ?? handle?.status,
    hasRunState:
      conversationId === null || (active.isSuccess && !active.isFetching),
    error: active.error,
    send,
    cancel,
    retry: () => {
      if (active.error || !handle) void active.refetch();
      if (conversationId && handle) {
        setRequestedSubscription({ conversationId, lastView: current?.view });
      }
    },
  };
};
