import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Conversation, Project, ProjectNode } from "@arch-flow/shared";
import { afterEach, expect, it, vi } from "vitest";
import { projectQueryKey } from "../lib/query-keys";

vi.mock("../hooks/use-auth", async () => ({
  useAuth: (await import("../lib/api-client")).getAuthState,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const BASE_URL = "https://api.example.test/api/v1";
const REQUEST_KEY = "6611ac35-7873-4c2e-a9a3-111ae6365e01";
const CREATED_AT = "2026-11-25T10:00:00.000Z";
const USER = {
  id: "6611ac35-7873-4c2e-a9a3-111ae6365e02",
  username: "Local user",
  email: "local@example.com",
  avatarUrl: null,
  createdAt: CREATED_AT,
};
const PROJECT: Project = {
  id: "6611ac35-7873-4c2e-a9a3-111ae6365e03",
  name: "测试项目",
  description: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};
const CONVERSATION: Conversation = {
  id: "6611ac35-7873-4c2e-a9a3-111ae6365e04",
  projectId: PROJECT.id,
  title: "新会话",
  updatedAt: CREATED_AT,
  draftGraph: null,
  draftVersion: 0,
  messageCount: 0,
  lastMessage: null,
  createdAt: CREATED_AT,
};
const ok = (data: unknown) =>
  Response.json({ code: "OK", message: "", traceId: "trace", data });

const readHook = <Result>(queryClient: QueryClient, useResult: () => Result) => {
  const capture: { value?: Result } = {};
  const Capture = () => {
    capture.value = useResult();
    return null;
  };
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: queryClient }, createElement(Capture)),
  );
  if (capture.value === undefined) throw new Error("React hook did not produce a result");
  return capture.value;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("opens the initial conversation after safely retrying a partially completed formal project creation", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", BASE_URL);
  vi.stubGlobal("location", new URL("https://app.example.test"));
  let conversationRequests = 0;
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
    if (url === `${BASE_URL}/auth/login`)
      return ok({ accessToken: "access", tokenType: "Bearer", expiresIn: 900, user: USER });
    if (url === `${BASE_URL}/projects`) return ok(PROJECT);
    if (url === `${BASE_URL}/projects/${PROJECT.id}/conversations`) {
      conversationRequests += 1;
      if (conversationRequests === 1) throw new Error("Response lost");
      return ok(CONVERSATION);
    }
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);

  const { signIn } = await import("../lib/api-client");
  const { useCreateProject } = await import("../hooks/use-projects");
  await signIn({ email: USER.email, password: "test-password" });
  const queryClient = new QueryClient();
  const onCreated = vi.fn();
  const { mutateAsync } = readHook(queryClient, () => useCreateProject({ onCreated }));
  const input = { name: PROJECT.name, idempotencyKey: REQUEST_KEY };
  try {
    await expect(mutateAsync(input)).rejects.toThrow(/项目已创建/);
    expect(onCreated).not.toHaveBeenCalled();
    const expected: ProjectNode = {
      ...PROJECT,
      assets: [],
      files: [],
      lastActiveConversationId: CONVERSATION.id,
      conversations: [{ id: CONVERSATION.id, title: CONVERSATION.title, updatedAt: CREATED_AT }],
    };
    await expect(mutateAsync(input)).resolves.toEqual(expected);
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(expected);
    expect(queryClient.getQueryData(projectQueryKey)).toMatchObject({ items: [expected] });
    expect(fetcher.mock.calls.slice(1).map(([url, init]) => [
      url,
      init?.method,
      new Headers(init?.headers).get("Idempotency-Key"),
      init?.body,
    ])).toEqual([
      [`${BASE_URL}/projects`, "POST", REQUEST_KEY, JSON.stringify({ name: PROJECT.name })],
      [`${BASE_URL}/projects/${PROJECT.id}/conversations`, "POST", REQUEST_KEY, "{}"],
      [`${BASE_URL}/projects`, "POST", REQUEST_KEY, JSON.stringify({ name: PROJECT.name })],
      [`${BASE_URL}/projects/${PROJECT.id}/conversations`, "POST", REQUEST_KEY, "{}"],
    ]);
  } finally {
    queryClient.clear();
  }
});

it("reports an unavailable formal delete before updating the project cache or fetching", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", BASE_URL);
  vi.stubGlobal("location", new URL("https://app.example.test"));
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { useDeleteProject } = await import("../hooks/use-delete-project-items");
  const queryClient = new QueryClient();
  const cacheWrite = vi.spyOn(queryClient, "setQueryData");
  const { mutateAsync } = readHook(queryClient, useDeleteProject);

  try {
    await expect(mutateAsync({ projectId: PROJECT.id, name: PROJECT.name, isActive: true }))
      .rejects.toThrow(/正式工作台暂未接入/);
    expect(cacheWrite).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    queryClient.clear();
  }
});
