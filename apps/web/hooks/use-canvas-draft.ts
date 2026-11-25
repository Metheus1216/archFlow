"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  Conversation,
  DraftLayout,
  LooseGraph,
  SaveDraftInput,
  SaveDraftResult,
} from "@arch-flow/shared";
import { ERROR_CODES } from "@arch-flow/shared/constants/error-codes";
import { ApiError, apiPath, getAuthState, requestApi } from "@/lib/api-client";
import {
  CANVAS_DRAFT_EDITS_QUERY_KEY,
  discardCanvasDraftEdits,
  type CanvasDraftEdit,
  type CanvasDraftEdits,
} from "@/lib/canvas-draft-edits";
import { conversationQueryKey, projectQueryKey } from "@/lib/query-keys";
import { readMockGraph } from "@/lib/read-mock-graph";
import { useAuth } from "./use-auth";

const AUTOSAVE_DELAY_MS = 3_000;
const SAVE_TIMEOUT_MS = 12_000;

export const useCanvasDraftEdit = (conversationId: string | null) => {
  const { data: edit } = useQuery<CanvasDraftEdits, Error, CanvasDraftEdit | null>({
    queryKey: CANVAS_DRAFT_EDITS_QUERY_KEY,
    enabled: false,
    initialData: () => new Map(),
    gcTime: Infinity,
    select: (drafts) => (conversationId ? drafts.get(conversationId) ?? null : null),
    structuralSharing: false,
  });
  return edit;
};

export const useCanvasDraft = (conversationId: string | null) => {
  const queryClient = useQueryClient();
  const userId = useAuth().user?.id;
  const [restoredVersions, setRestoredVersions] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const restoredVersion = conversationId
    ? restoredVersions.get(conversationId)
    : undefined;
  const restoreFilters = useMemo(
    () => ({
      mutationKey: ["restore-canvas-draft", userId, conversationId],
      exact: true,
    }),
    [conversationId, userId],
  );
  const restoring = useIsMutating(restoreFilters) > 0;

  const actions = useMemo(() => {
    const queryKey = conversationQueryKey(conversationId ?? "none");
    const read = () =>
      conversationId
        ? queryClient.getQueryData<CanvasDraftEdits>(CANVAS_DRAFT_EDITS_QUERY_KEY)?.get(conversationId)
        : undefined;
    const write = (next: CanvasDraftEdit | null) => {
      if (!conversationId) return;
      if (next === null) {
        discardCanvasDraftEdits(queryClient, [conversationId]);
        return;
      }
      queryClient.setQueryData<CanvasDraftEdits>(
        CANVAS_DRAFT_EDITS_QUERY_KEY,
        (drafts) => new Map(drafts).set(conversationId, next),
      );
    };
    const isCurrentUser = () =>
      Boolean(userId && getAuthState().user?.id === userId);
    const isRestoring = () => queryClient.isMutating(restoreFilters) > 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const putDraft = async (input: SaveDraftInput) => {
      if (!conversationId) throw new Error("请先打开会话。");
      return requestApi<SaveDraftResult>(
        apiPath(`/conversations/${encodeURIComponent(conversationId)}/draft`),
        {
          method: "PUT",
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
        },
      );
    };

    const updateSavedDraft = (
      { graph, layout }: SaveDraftInput,
      { draftVersion, updatedAt }: SaveDraftResult,
    ) => {
      queryClient.setQueryData<Conversation>(queryKey, (saved) =>
        saved && saved.draftVersion < draftVersion
          ? {
              ...saved,
              draftGraph: graph,
              draftLayout: layout,
              draftVersion,
              updatedAt: saved.updatedAt > updatedAt ? saved.updatedAt : updatedAt,
            }
          : saved,
      );
    };

    const persistDraft = async (
      input: SaveDraftInput,
      request: Promise<SaveDraftResult>,
    ) => {
      try {
        const result = await request;
        if (!isCurrentUser() || read()?.writing?.input !== input) return;
        await queryClient.cancelQueries({ queryKey, exact: true });
        const latest = read();
        if (!isCurrentUser() || latest?.writing?.input !== input) return;

        updateSavedDraft(input, result);
        const movedAgain = latest.layout !== input.layout;
        write(
          movedAgain || latest.moving
            ? {
                ...latest,
                baseVersion: result.draftVersion,
                writing: undefined,
                saveAfter: movedAgain ? latest.saveAfter : undefined,
              }
            : null,
        );
        schedule();
        void queryClient.invalidateQueries({ queryKey, exact: true });
        void queryClient.invalidateQueries({ queryKey: projectQueryKey });
      } catch (error) {
        const latest = read();
        if (!isCurrentUser() || latest?.writing?.input !== input) return;
        const conflict =
          error instanceof ApiError &&
          error.code === ERROR_CODES.DRAFT_VERSION_CONFLICT;
        const message = conflict
          ? "这份画布已有新版。读取最新版会放弃本页待保存的调整。"
          : error instanceof ApiError
            ? error.message
            : "保存请求失败，本页的调整已保留。";
        write({
          ...latest,
          writing: undefined,
          failure: { conflict, message },
        });
      }
    };

    const save = async () => {
      clearTimeout(timer);
      if (!conversationId || !isCurrentUser() || isRestoring()) return;

      const current = read();
      if (current?.writing) {
        await current.writing.completion;
        return;
      }
      if (!current?.saveAfter || current.moving || current.failure?.conflict)
        return;

      const { graph, layout, baseVersion } = current;
      const input: SaveDraftInput = { graph, layout, baseVersion };
      const completion = persistDraft(input, putDraft(input));
      write({ ...current, writing: { input, completion }, failure: undefined });
      await completion;
    };

    const flush = async () => {
      if (!conversationId) return false;
      while (isCurrentUser() && !isRestoring()) {
        const current = read();
        if (current?.moving || current?.failure) return false;
        if (!current?.saveAfter && !current?.writing) return true;
        await save();
      }
      return false;
    };

    const schedule = () => {
      clearTimeout(timer);
      const current = read();
      if (
        !current?.saveAfter ||
        current.moving ||
        current.writing ||
        current.failure
      )
        return;
      timer = setTimeout(
        () => {
          if ((read()?.saveAfter ?? 0) > Date.now()) schedule();
          else void save();
        },
        Math.max(0, current.saveAfter - Date.now()),
      );
    };

    const startMove = (basis: SaveDraftInput) => {
      if (!isCurrentUser() || isRestoring()) return;
      const current = read();
      if (current?.failure?.conflict) return;
      clearTimeout(timer);
      write({ ...(current ?? basis), moving: true });
    };

    const changeLayout = (basis: SaveDraftInput, layout: DraftLayout) => {
      if (!isCurrentUser() || isRestoring()) return;
      const current = read();
      if (current?.failure?.conflict && !current.moving) return;
      write({
        ...basis,
        moving: false,
        ...current,
        layout,
        saveAfter: Date.now() + AUTOSAVE_DELAY_MS,
      });
      schedule();
    };

    const finishMove = () => {
      const current = read();
      if (!isCurrentUser() || !current?.moving) return;
      write(current.saveAfter ? { ...current, moving: false } : null);
      schedule();
    };

    const reloadLatest = async () => {
      const current = read();
      if (
        !conversationId ||
        !isCurrentUser() ||
        isRestoring() ||
        !current?.failure?.conflict ||
        current.reloading
      )
        return false;
      const reloading = { ...current, reloading: true };
      write(reloading);
      try {
        const latest = await requestApi<Conversation>(
          apiPath(`/conversations/${encodeURIComponent(conversationId)}`),
          {
            signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
          },
        );
        if (!isCurrentUser() || read() !== reloading) return false;
        if (latest.draftVersion <= current.baseVersion)
          throw new Error("服务端暂未返回最新版本");
        await queryClient.cancelQueries({ queryKey, exact: true });
        if (!isCurrentUser() || read() !== reloading) return false;
        queryClient.setQueryData<Conversation>(queryKey, (saved) =>
          !saved || saved.draftVersion <= latest.draftVersion ? latest : saved,
        );
        write(null);
        void queryClient.invalidateQueries({ queryKey, exact: true });
        return true;
      } catch {
        if (isCurrentUser() && read() === reloading) {
          write({
            ...current,
            failure: { conflict: true, message: "读取最新画布失败，请重试。" },
          });
        }
        return false;
      }
    };

    const restore = async ({
      snapshot,
      baseVersion,
    }: {
      snapshot: LooseGraph;
      baseVersion: number;
    }) => {
      if (!conversationId || !isCurrentUser())
        throw new Error("请重新打开会话再试。");
      const graph = readMockGraph(snapshot);
      if (!graph) throw new Error("这条消息的画布快照无法恢复。");

      const current = read();
      if (current?.moving || current?.reloading) {
        throw new Error("画布正在调整，请稍后重试。");
      }

      clearTimeout(timer);
      try {
        await current?.writing?.completion;
        if (!isCurrentUser()) throw new Error("请重新打开会话再试。");
        const input: SaveDraftInput = { graph, baseVersion };
        const result = await putDraft(input);
        await queryClient.cancelQueries({ queryKey, exact: true });
        if (!isCurrentUser()) throw new Error("请重新打开会话再试。");
        updateSavedDraft(input, result);
        write(null);
        setRestoredVersions((versions) =>
          new Map(versions).set(conversationId, result.draftVersion),
        );
        void queryClient.invalidateQueries({ queryKey: projectQueryKey });
      } catch (error) {
        if (error instanceof ApiError || !isCurrentUser()) throw error;
        throw new Error("暂时无法确认恢复结果，请查看当前画布后重试。", {
          cause: error,
        });
      } finally {
        if (isCurrentUser()) {
          schedule();
          void queryClient.invalidateQueries({ queryKey, exact: true });
        }
      }
    };

    return { startMove, finishMove, changeLayout, save, flush, reloadLatest, restore };
  }, [conversationId, queryClient, restoreFilters, userId]);

  const { restore: restoreDraft, ...draftActions } = actions;
  const { mutateAsync: restore } = useMutation({
    mutationKey: restoreFilters.mutationKey,
    mutationFn: restoreDraft,
    networkMode: "always",
  });

  const restoreSnapshot = async (snapshot: LooseGraph, baseVersion: number) => {
    if (queryClient.isMutating(restoreFilters))
      throw new Error("画布正在恢复，请稍后重试。");
    await restore({ snapshot, baseVersion });
  };

  useEffect(() => actions.finishMove, [actions]);

  return { ...draftActions, restoreSnapshot, restoredVersion, restoring };
};
