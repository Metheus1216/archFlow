import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Message, Run, RunAccepted } from "@arch-flow/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activeRunQueryKey } from "../lib/query-keys";

const BASE_URL = "http://localhost:3001/api/v1";
const CONVERSATION_ID = "conversation_1";
const MESSAGE_ID = "assistant_1";
const IDEMPOTENCY_KEY = "6611ac35-7873-4c2e-a9a3-111ae6365efb";
const CREATED_AT = "2026-11-25T10:00:00.000Z";
const ACCEPTED: RunAccepted = {
  runId: "run_1",
  assistantMessageId: MESSAGE_ID,
  userMessageId: "user_1",
  streamUrl: "/api/v1/runs/run_1/stream",
  status: "queued",
};
const RUN: Run = {
  id: ACCEPTED.runId,
  conversationId: CONVERSATION_ID,
  assistantMessageId: ACCEPTED.assistantMessageId,
  userMessageId: ACCEPTED.userMessageId,
  status: "succeeded",
  finishReason: "stop",
  createdAt: CREATED_AT,
  finishedAt: CREATED_AT,
  error: null,
};
const MESSAGE: Message = {
  id: MESSAGE_ID,
  role: "assistant",
  content: "这是数据库中的正文",
  createdAt: CREATED_AT,
  graphSnapshot: { nodes: [], edges: [] },
  metadata: null,
};

const ok = (data: unknown) =>
  Response.json({ code: "OK", message: "", traceId: "trace", data });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", BASE_URL);
  vi.stubGlobal("location", new URL("http://localhost:3000"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("uses the formal card endpoint and keeps a typed graph selection in the message endpoint", async () => {
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => ok(ACCEPTED));
  vi.stubGlobal("fetch", fetcher);
  const { useSendMessage } = await import("../hooks/use-send-message");
  const queryClient = new QueryClient();
  const onAccepted = vi.fn();
  const capture: { mutation?: ReturnType<typeof useSendMessage> } = {};
  const Capture = () => {
    capture.mutation = useSendMessage(onAccepted);
    return null;
  };
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: queryClient }, createElement(Capture)),
  );
  if (!capture.mutation) throw new Error("React hook did not produce a mutation");

  const submission = { conversationId: CONVERSATION_ID, idempotencyKey: IDEMPOTENCY_KEY };
  try {
    await capture.mutation.mutateAsync({
      ...submission,
      content: "postgres",
      interruptId: "card_1",
      cardMessageId: MESSAGE_ID,
    });
    await capture.mutation.mutateAsync({
      ...submission,
      content: "解释第一版",
      interruptId: "card_1",
      graphReferenceMessageId: "assistant_old",
    });
    expect(fetcher.mock.calls.map(([url, init]) => [
      url,
      init?.method,
      new Headers(init?.headers).get("Idempotency-Key"),
      JSON.parse(String(init?.body)),
    ])).toEqual([
      [`${BASE_URL}/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/answer`, "POST",
        IDEMPOTENCY_KEY, { cardId: "card_1", values: ["postgres"], isCustom: false }],
      [`${BASE_URL}/conversations/${CONVERSATION_ID}/messages`, "POST", IDEMPOTENCY_KEY,
        { content: "解释第一版", graphReferenceMessageId: "assistant_old" }],
    ]);
    expect(queryClient.getQueryData(activeRunQueryKey(CONVERSATION_ID))).toEqual({ run: ACCEPTED, latest: ACCEPTED });
    expect(onAccepted.mock.calls).toEqual([[CONVERSATION_ID], [CONVERSATION_ID]]);
  } finally {
    queryClient.clear();
  }
});

it("rebuilds the polled run from its persisted assistant message", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url === `${BASE_URL}/runs/${RUN.id}`) return ok(RUN);
    if (url === `${BASE_URL}/conversations/${CONVERSATION_ID}/messages?limit=50&direction=backward`)
      return ok({ items: [{ ...MESSAGE, id: "assistant_other" }, MESSAGE], hasMore: false, nextCursor: null });
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const { readRunView } = await import("../hooks/use-conversation-run");
  const { createRunView } = await import("../lib/run-view");
  const view = createRunView(ACCEPTED);
  view.message.content = "过期的本地文字";

  await expect(readRunView(CONVERSATION_ID, view, new AbortController().signal)).resolves.toMatchObject({
    status: "succeeded",
    message: MESSAGE,
  });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    `${BASE_URL}/runs/${RUN.id}`,
    `${BASE_URL}/conversations/${CONVERSATION_ID}/messages?limit=50&direction=backward`,
  ]);
});
