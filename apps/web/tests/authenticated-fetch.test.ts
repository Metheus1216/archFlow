import { afterEach, beforeEach, expect, it, vi } from "vitest";

const USER = {
  id: "6611ac35-7873-4c2e-a9a3-111ae6365efb",
  username: "Local user",
  email: "local@example.com",
  avatarUrl: null,
  createdAt: "2026-11-23T10:00:00.000Z",
};

const ok = (data: unknown) => Response.json({ code: "OK", message: "", traceId: "trace", data });
const failure = (code: string) => Response.json({ code, message: "登录失效", traceId: "trace", data: null }, { status: 401 });
const token = (accessToken: string) => ({ accessToken, tokenType: "Bearer", expiresIn: 900 });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");
  vi.stubGlobal("location", new URL("http://localhost:3000"));
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, work: () => Promise<unknown>) => work() } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("coalesces expired requests and replays each once with the original request identity", async () => {
  const calls: { input: string; header: string | null; key: string | null; body?: BodyInit | null; signal?: AbortSignal | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ input: new URL(input).pathname, header: headers.get("authorization"), key: headers.get("idempotency-key"), body: init?.body, signal: init?.signal });
    if (input.endsWith("/login")) return ok({ ...token("first"), user: USER });
    if (input.endsWith("/refresh")) return ok(token("second"));
    if (input.endsWith("/me")) return ok(USER);
    return headers.get("authorization") === "Bearer second" ? ok({ accepted: true }) : failure("TOKEN_EXPIRED");
  }));

  const client = await import("../lib/api-client");
  expect(client.authenticatedFetch, "authenticated fetch should exist").toBeTypeOf("function");
  await client.signIn({ email: USER.email, password: "test-password" });
  const call = { method: "POST", headers: { "Idempotency-Key": USER.id }, body: '{"name":"My project"}', signal: new AbortController().signal };
  const path = "/api/mock/projects";
  const results = await Promise.all([client.authenticatedFetch(path, call), client.authenticatedFetch(path, call)]);
  expect(results.map((response) => response.status)).toEqual([200, 200]);
  expect(calls.filter(({ input }) => input.endsWith("/refresh"))).toHaveLength(1);
  expect(calls.filter(({ input }) => input === path)).toEqual([
    ...Array.from({ length: 2 }, () => ({ input: path, header: "Bearer first", key: USER.id, body: call.body, signal: call.signal })),
    ...Array.from({ length: 2 }, () => ({ input: path, header: "Bearer second", key: USER.id, body: call.body, signal: call.signal })),
  ]);
});

it("never sends the bearer across origins and does not refresh a missing or invalid token", async () => {
  const fetcher = vi.fn(async (input: string) => {
    if (input.endsWith("/login")) return ok({ ...token("first"), user: USER });
    return failure("TOKEN_INVALID");
  });
  vi.stubGlobal("fetch", fetcher);
  const client = await import("../lib/api-client");
  expect(client.authenticatedFetch, "authenticated fetch should exist").toBeTypeOf("function");
  await client.signIn({ email: USER.email, password: "test-password" });
  await expect(client.authenticatedFetch("https://elsewhere.example/api/mock/projects")).rejects.toThrow();
  const response = await client.authenticatedFetch("/api/mock/projects");
  expect(response.status).toBe(401);
  expect(fetcher.mock.calls).toEqual([
    ["http://localhost:3000/api/mock/auth/login", expect.anything()],
    ["http://localhost:3000/api/mock/projects", expect.anything()],
  ]);
});

it("lets the browser encode authenticated FormData with a multipart boundary", async () => {
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    if (input.endsWith("/login")) return ok({ ...token("access"), user: USER });

    const request = new Request(input, init);
    expect(request.headers.get("authorization")).toBe("Bearer access");
    expect(request.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    const file = (await request.formData()).get("file");
    expect(file).toBeInstanceOf(File);
    if (!(file instanceof File)) throw new Error("Browser did not send a file");
    expect(file.name).toBe("architecture.md");
    expect(await file.text()).toBe("# Architecture");
    return ok({ id: "uploaded" });
  });
  vi.stubGlobal("fetch", fetcher);

  const client = await import("../lib/api-client");
  await client.signIn({ email: USER.email, password: "test-password" });
  const body = new FormData();
  body.set("file", new File(["# Architecture"], "architecture.md", { type: "text/markdown" }));

  await expect(client.requestApi("/api/mock/projects/project/files", { method: "POST", body })).resolves.toEqual({
    id: "uploaded",
  });
});

it("scopes formal session renewal and business requests to the configured API", async () => {
  const baseUrl = "http://localhost:3001/api/v1";
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", `${baseUrl}/`);
  const requestLock = vi.fn(async (_name: string, work: () => Promise<unknown>) => work());
  vi.stubGlobal("navigator", { locks: { request: requestLock } });
  const tabChannel = vi.fn();
  vi.stubGlobal("BroadcastChannel", class {
    onmessage: unknown;
    constructor(name: string) { tabChannel(name); }
    close = vi.fn();
  });
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
    url.endsWith("/refresh") ? ok(token("formal-token")) : ok(USER),
  );
  vi.stubGlobal("fetch", fetcher);

  const client = await import("../lib/api-client");
  const disconnect = client.connectAuthTabs();
  await client.restoreSession();

  expect(client.getAuthState()).toEqual({ status: "authenticated", user: USER });
  expect(client.apiPath("/projects?limit=20")).toBe(`${baseUrl}/projects?limit=20`);
  await client.authenticatedFetch(client.apiPath("/projects"), { redirect: "follow", credentials: "include" });
  for (const input of [
    "/api/mock/projects",
    "/api/v10/projects",
    "/api/v1/auth/me",
    "/api/v1/projects/../../../outside",
    "https://elsewhere.example/api/v1/projects",
  ]) {
    await expect(client.authenticatedFetch(input)).rejects.toThrow(/受信任/);
  }

  expect(fetcher.mock.calls.map(([url, init]) => ({
    url,
    credentials: init?.credentials,
    redirect: init?.redirect,
    authorization: new Headers(init?.headers).get("authorization"),
  }))).toEqual([
    { url: `${baseUrl}/auth/refresh`, credentials: "include", redirect: "error", authorization: null },
    { url: `${baseUrl}/auth/me`, credentials: "include", redirect: "error", authorization: "Bearer formal-token" },
    { url: `${baseUrl}/projects`, credentials: "omit", redirect: "error", authorization: "Bearer formal-token" },
  ]);
  const [[lockName]] = requestLock.mock.calls;
  expect(lockName).toContain(baseUrl);
  expect(tabChannel).toHaveBeenCalledWith(lockName);
  disconnect?.();
});

it.each([
  "http://api.example.com/api/v1",
  "https://name:password@api.example.com/api/v1",
  "https://api.example.com/api/mock",
  "https://api.example.com/api/v1?extra=1",
])("rejects an invalid formal API configuration %s without falling back to Mock", async (baseUrl) => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", baseUrl);

  await expect(import("../lib/api-client")).rejects.toThrow(/NEXT_PUBLIC_API_BASE_URL/);
});
