import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AssetInput, Conversation } from "@arch-flow/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../hooks/use-auth", async () => ({
  useAuth: (await import("../lib/api-client")).getAuthState,
}));

const BASE_URL = "https://api.example.test/api/v1";
const TIMESTAMP = "2026-11-25T10:00:00.000Z";
const REQUEST_KEY = "6611ac35-7873-4c2e-a9a3-111ae6365e01";
const PROJECT_ID = "6611ac35-7873-4c2e-a9a3-111ae6365e02";
const CONVERSATION_ID = "6611ac35-7873-4c2e-a9a3-111ae6365e03";
const OTHER_CONVERSATION_ID = "6611ac35-7873-4c2e-a9a3-111ae6365e04";
const ASSET_ID = "6611ac35-7873-4c2e-a9a3-111ae6365e05";
const MESSAGE_ID = "6611ac35-7873-4c2e-a9a3-111ae6365e06";
const USER = {
  id: "6611ac35-7873-4c2e-a9a3-111ae6365e07",
  username: "Formal user",
  email: "local@example.test",
  avatarUrl: null,
  createdAt: TIMESTAMP,
};
const SAVED_CANVAS: AssetInput = {
  graph: { nodes: [{ id: "client", label: "客户端", type: "client" }], edges: [] },
  layout: [{ nodeId: "client", x: 120, y: 80 }],
  name: "架构图",
};
const ASSET = { id: ASSET_ID, name: SAVED_CANVAS.name, createdAt: TIMESTAMP, updatedAt: TIMESTAMP };
const CONVERSATION: Conversation = {
  id: OTHER_CONVERSATION_ID,
  projectId: PROJECT_ID,
  title: "新分支",
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  draftGraph: SAVED_CANVAS.graph,
  draftVersion: 0,
  messageCount: 1,
  lastMessage: null,
};

const ok = (data: unknown) => Response.json({ code: "OK", message: "", traceId: "trace", data });

const readHook = <Result>(client: QueryClient, useResult: () => Result) => {
  const capture: { value?: Result } = {};
  const ReadResult = () => {
    capture.value = useResult();
    return null;
  };
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ReadResult)));
  if (capture.value === undefined) throw new Error("React hook did not produce a result");
  return capture.value;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("uses formal authorized routes to restore, save and reopen an asset, and fork", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", BASE_URL);
  vi.stubGlobal("location", new URL("https://app.example.test"));
  const forked = { ...CONVERSATION, forkedFrom: { conversationId: CONVERSATION_ID, sourceMessageId: MESSAGE_ID } };
  const assetDetail = { ...ASSET, ...SAVED_CANVAS };
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url === `${BASE_URL}/auth/login`) return ok({ accessToken: "access", tokenType: "Bearer", expiresIn: 900, user: USER });
    if (url === `${BASE_URL}/conversations/${CONVERSATION_ID}/draft`) return ok({ updatedAt: TIMESTAMP, draftVersion: 5 });
    if (url === `${BASE_URL}/projects/${PROJECT_ID}/assets`) return ok(ASSET);
    if (url === `${BASE_URL}/projects/${PROJECT_ID}/assets/${ASSET_ID}`) return ok(assetDetail);
    if (url === `${BASE_URL}/conversations/${CONVERSATION_ID}/fork`) return ok(forked);
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);

  const { signIn } = await import("../lib/api-client");
  const { useCanvasDraft } = await import("../hooks/use-canvas-draft");
  const { useProjectAsset, useSaveProjectAsset } = await import("../hooks/use-project-asset");
  const { useForkConversation } = await import("../hooks/use-fork-conversation");
  await signIn({ email: USER.email, password: "test-password" });

  const client = new QueryClient();
  const draft = readHook(client, () => useCanvasDraft(CONVERSATION_ID));
  const saveAsset = readHook(client, useSaveProjectAsset);
  const asset = readHook(client, () => useProjectAsset(PROJECT_ID, ASSET_ID));
  const fork = readHook(client, useForkConversation);

  try {
    await draft.restoreSnapshot(SAVED_CANVAS.graph, 4);
    await expect(saveAsset.mutateAsync({ ownerId: USER.id, projectId: PROJECT_ID, input: SAVED_CANVAS, idempotencyKey: REQUEST_KEY })).resolves.toEqual(ASSET);
    await expect(asset.refetch({ throwOnError: true })).resolves.toMatchObject({ data: assetDetail });
    await expect(fork.mutateAsync({ conversationId: CONVERSATION_ID, sourceMessageId: MESSAGE_ID, idempotencyKey: REQUEST_KEY })).resolves.toEqual(forked);
    expect(fetcher.mock.calls.slice(1).map(([url, init]) => [
      url,
      init?.method ?? "GET",
      new Headers(init?.headers).get("Authorization"),
      new Headers(init?.headers).get("Idempotency-Key"),
      init?.body ? JSON.parse(String(init.body)) : undefined,
    ])).toEqual([
      [`${BASE_URL}/conversations/${CONVERSATION_ID}/draft`, "PUT", "Bearer access", null, { graph: SAVED_CANVAS.graph, baseVersion: 4 }],
      [`${BASE_URL}/projects/${PROJECT_ID}/assets`, "POST", "Bearer access", REQUEST_KEY, SAVED_CANVAS],
      [`${BASE_URL}/projects/${PROJECT_ID}/assets/${ASSET_ID}`, "GET", "Bearer access", null, undefined],
      [`${BASE_URL}/conversations/${CONVERSATION_ID}/fork`, "POST", "Bearer access", REQUEST_KEY, { sourceMessageId: MESSAGE_ID }],
    ]);
  } finally {
    client.clear();
  }
});
