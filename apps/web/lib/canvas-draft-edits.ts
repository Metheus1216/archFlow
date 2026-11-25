import type { SaveDraftInput } from "@arch-flow/shared";
import type { QueryClient } from "@tanstack/react-query";

export const CANVAS_DRAFT_EDITS_QUERY_KEY = ["canvas-draft-edits"] as const;

export type CanvasDraftEdit = SaveDraftInput & {
  moving: boolean;
  saveAfter?: number;
  writing?: { input: SaveDraftInput; completion: Promise<void> };
  failure?: { conflict: boolean; message: string };
  reloading?: boolean;
};

export type CanvasDraftEdits = ReadonlyMap<string, CanvasDraftEdit>;

export const discardCanvasDraftEdits = (
  queryClient: QueryClient,
  conversationIds: readonly string[],
) =>
  queryClient.setQueryData<CanvasDraftEdits>(CANVAS_DRAFT_EDITS_QUERY_KEY, (drafts) => {
    if (!drafts?.size) return drafts;
    const remaining = new Map(drafts);
    for (const conversationId of conversationIds) remaining.delete(conversationId);
    return remaining;
  });

export const watchUnsavedCanvasDrafts = (
  queryClient: QueryClient,
  target: EventTarget,
) => {
  const warnOnExit = (event: Event) => event.preventDefault();
  let listening = false;
  const syncWarning = () => {
    const drafts = queryClient.getQueryData<CanvasDraftEdits>(CANVAS_DRAFT_EDITS_QUERY_KEY);
    const hasUnsavedDraft = Boolean(drafts?.size);
    if (hasUnsavedDraft === listening) return;

    listening = hasUnsavedDraft;
    if (listening) target.addEventListener("beforeunload", warnOnExit);
    else target.removeEventListener("beforeunload", warnOnExit);
  };

  const unsubscribe = queryClient.getQueryCache().subscribe(({ query }) => {
    if (query.queryKey[0] === CANVAS_DRAFT_EDITS_QUERY_KEY[0]) syncWarning();
  });
  syncWarning();

  return () => {
    unsubscribe();
    if (listening) target.removeEventListener("beforeunload", warnOnExit);
  };
};
