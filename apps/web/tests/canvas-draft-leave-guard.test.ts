import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import {
  CANVAS_DRAFT_EDITS_QUERY_KEY,
  watchUnsavedCanvasDrafts,
  type CanvasDraftEdit,
} from "../lib/canvas-draft-edits";

const failedDraft: CanvasDraftEdit = {
  graph: { nodes: [{ id: "api", type: "service", label: "API" }], edges: [] },
  layout: [{ nodeId: "api", x: 100, y: 200 }],
  baseVersion: 2,
  moving: false,
  saveAfter: Date.now(),
  failure: { conflict: false, message: "保存请求失败" },
};

it("warns about a failed draft in another conversation until it is saved", () => {
  const queryClient = new QueryClient();
  const browser = new EventTarget();
  const tryLeaving = () =>
    browser.dispatchEvent(new Event("beforeunload", { cancelable: true }));
  const stopWatching = watchUnsavedCanvasDrafts(queryClient, browser);

  try {
    expect(tryLeaving()).toBe(true);

    queryClient.setQueryData(CANVAS_DRAFT_EDITS_QUERY_KEY, new Map([
      ["conversation-a", failedDraft],
    ]));
    expect(tryLeaving()).toBe(false);

    queryClient.setQueryData(CANVAS_DRAFT_EDITS_QUERY_KEY, new Map());
    expect(tryLeaving()).toBe(true);
  } finally {
    stopWatching();
    queryClient.clear();
  }
});

it("removes the warning when the account cache is cleared", () => {
  const queryClient = new QueryClient();
  const browser = new EventTarget();
  const tryLeaving = () =>
    browser.dispatchEvent(new Event("beforeunload", { cancelable: true }));
  queryClient.setQueryData(CANVAS_DRAFT_EDITS_QUERY_KEY, new Map([
    ["conversation-a", failedDraft],
  ]));
  const stopWatching = watchUnsavedCanvasDrafts(queryClient, browser);

  try {
    expect(tryLeaving()).toBe(false);

    queryClient.clear();
    expect(tryLeaving()).toBe(true);
  } finally {
    stopWatching();
    queryClient.clear();
  }
});
