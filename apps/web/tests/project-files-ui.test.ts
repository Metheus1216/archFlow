import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import {
  FILE_UPLOAD_MAX_BYTES,
  type FileBrief,
  type FileMeta,
  type ProjectNode,
} from "@arch-flow/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toast } from "sonner";
import { afterEach, expect, it, vi } from "vitest";
import {
  getUploadFileError,
  mergeProjectFileStatuses,
  useProjectFileStatuses,
  useUploadProjectFile,
} from "../hooks/use-project-files";
import { signIn } from "../lib/api-client";
import { projectQueryKey } from "../lib/query-keys";

vi.mock("../hooks/use-auth", async () => ({
  useAuth: (await import("../lib/api-client")).getAuthState,
}));

const USER = {
  id: "6611ac35-7873-4c2e-a9a3-111ae6365efb",
  username: "Local user",
  email: "local@example.com",
  avatarUrl: null,
  createdAt: "2026-11-24T10:00:00.000Z",
};
const OTHER_USER = { ...USER, id: "6611ac35-7873-4c2e-a9a3-111ae6365efc", email: "other@example.com" };

const ok = (data: unknown) => Response.json({ code: "OK", message: "", traceId: "trace", data });

const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => {};
  const promise = new Promise<Value>((complete) => { resolve = complete; });
  return { promise, resolve };
};

const delayResponseDecoding = (response: Response) => {
  const started = deferred<void>();
  const release = deferred<void>();
  const readJson = response.json.bind(response);
  vi.spyOn(response, "json").mockImplementation(async () => {
    started.resolve();
    await release.promise;
    return readJson();
  });
  return { started: started.promise, release: release.resolve };
};

const signInWith = async (fetchProjectFile: (url: string) => Promise<Response>, user = USER) => {
  vi.stubGlobal("location", new URL("http://localhost:3000"));
  vi.stubGlobal("fetch", (url: string) => url.endsWith("/login")
    ? Promise.resolve(ok({ accessToken: "access", tokenType: "Bearer", expiresIn: 900, user }))
    : fetchProjectFile(url));
  await signIn({ email: user.email, password: "test-password" });
};

const readHook = <Result>(queryClient: QueryClient, useResult: () => Result): Result => {
  const result: { current?: Result } = {};
  const Capture = () => {
    result.current = useResult();
    return null;
  };
  renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient }, createElement(Capture)));
  if (result.current === undefined) throw new Error("React hook did not produce a result");
  return result.current;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const makeFile = (id: string, status: FileBrief["status"] = "processing"): FileBrief => ({
  id,
  fileName: `${id}.md`,
  fileType: "text",
  status,
  createdAt: "2026-11-24T10:00:00.000Z",
});

const makeProject = (id: string, files: FileBrief[]): ProjectNode => ({
  id,
  name: id,
  description: null,
  createdAt: "2026-11-24T10:00:00.000Z",
  updatedAt: "2026-11-24T10:00:00.000Z",
  lastActiveConversationId: null,
  files,
  assets: [],
  conversations: [],
});

const makePage = (...items: ProjectNode[]) => ({ items, nextCursor: null, hasMore: false });

const uploadResult = (file: FileBrief): FileMeta => ({
  ...file,
  errorMessage: null,
  mimeType: "text/markdown",
  sizeBytes: 200,
});

it("accepts supported uppercase file types and rejects empty, oversized or unsupported uploads", () => {
  expect(getUploadFileError({ name: "Architecture.MD", size: FILE_UPLOAD_MAX_BYTES })).toBeNull();
  expect(getUploadFileError({ name: "Architecture.MD", size: FILE_UPLOAD_MAX_BYTES + 1 })).toMatch(/超过/);
  expect(getUploadFileError({ name: "empty.txt", size: 0 })).toMatch(/空/);
  expect(getUploadFileError({ name: "archive.zip", size: 123 })).toMatch(/不支持/);
});

it("applies terminal status only to still-present scoped files and removes missing ones", () => {
  const other = makeProject("other", [makeFile("waiting")]);
  const ready = makeFile("ready", "ready");
  const page = makePage(makeProject("target", [makeFile("waiting"), makeFile("removed"), ready]), other);
  const result = mergeProjectFileStatuses(page, "target", ["waiting", "removed", "gone", "ready"], [
    { id: "waiting", status: "failed", errorMessage: "无法读取文本编码" },
    { id: "gone", status: "ready", errorMessage: null },
    { id: "ready", status: "processing", errorMessage: null },
  ]);

  expect(result?.items[0].files).toEqual([
    { ...makeFile("waiting", "failed"), errorMessage: "无法读取文本编码" },
    ready,
  ]);
  expect(result?.items[1]).toBe(other);
});

it("does not reinsert a deleted file when an exact upload retry returns its old snapshot", async () => {
  const file = makeFile("existing", "ready");
  const queryClient = new QueryClient();
  const started = deferred<void>();
  const response = deferred<Response>();
  await signInWith(async (url) => {
    if (!url.endsWith("/projects/project/files")) throw new Error(`Unexpected request ${url}`);
    started.resolve();
    return response.promise;
  });
  queryClient.setQueryData(projectQueryKey, makePage(makeProject("project", [file])));

  try {
    const upload = readHook(queryClient, useUploadProjectFile).mutateAsync({
      ownerId: USER.id,
      projectId: "project",
      file: new File(["# Evidence"], file.fileName),
      signal: new AbortController().signal,
    });
    await started.promise;
    const afterDelete = makePage(makeProject("project", []));
    queryClient.setQueryData(projectQueryKey, afterDelete);
    response.resolve(ok(uploadResult(file)));
    await upload;

    expect(queryClient.getQueryData(projectQueryKey)).toEqual(afterDelete);
    expect(queryClient.getQueryState(projectQueryKey)?.isInvalidated).toBe(true);
  } finally {
    queryClient.clear();
  }
});

it("does not announce a successful upload when canceled during response decoding", async () => {
  const success = vi.spyOn(toast, "success");
  const controller = new AbortController();
  const queryClient = new QueryClient();
  const file = makeFile("committed");
  const reply = ok(uploadResult(file));
  const decoding = delayResponseDecoding(reply);
  await signInWith(async (url) => {
    if (!url.endsWith("/projects/project/files")) throw new Error(`Unexpected request ${url}`);
    return reply;
  });
  queryClient.setQueryData(projectQueryKey, makePage(makeProject("project", [])));

  try {
    const upload = readHook(queryClient, useUploadProjectFile).mutateAsync({
      ownerId: USER.id,
      projectId: "project",
      file: new File(["# Evidence"], file.fileName),
      signal: controller.signal,
    });
    await decoding.started;
    controller.abort();
    decoding.release();
    await expect(upload).rejects.toMatchObject({ name: "AbortError" });

    expect(success).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(projectQueryKey)?.isInvalidated).toBe(true);
  } finally {
    decoding.release();
    queryClient.clear();
  }
});

it("drops late upload responses after an account switch", async () => {
  const success = vi.spyOn(toast, "success");
  const queryClient = new QueryClient();
  const file = makeFile("private");
  const reply = ok(uploadResult(file));
  const decoding = delayResponseDecoding(reply);
  await signInWith(async (url) => {
    if (!url.endsWith("/projects/project/files")) throw new Error(`Unexpected request ${url}`);
    return reply;
  });

  try {
    const upload = readHook(queryClient, useUploadProjectFile).mutateAsync({
      ownerId: USER.id,
      projectId: "project",
      file: new File(["# Private"], file.fileName),
      signal: new AbortController().signal,
    });
    await decoding.started;
    await signInWith(async (url) => { throw new Error(`Unexpected request ${url}`); }, OTHER_USER);
    queryClient.clear();
    const otherPage = makePage(makeProject("other", []));
    queryClient.setQueryData(projectQueryKey, otherPage);
    decoding.release();

    await expect(upload).rejects.toMatchObject({ name: "AbortError" });
    expect(queryClient.getQueryData(projectQueryKey)).toEqual(otherPage);
    expect(queryClient.getQueryState(projectQueryKey)?.isInvalidated).toBe(false);
    expect(success).not.toHaveBeenCalled();
  } finally {
    decoding.release();
    queryClient.clear();
  }
});

it("does not cancel the new account's project refresh when an old file status response arrives", async () => {
  vi.useFakeTimers();
  const queryClient = new QueryClient();
  const file = makeFile("private");
  const reply = ok({ items: [{ id: file.id, status: "ready", errorMessage: null }] });
  const decoding = delayResponseDecoding(reply);
  const refreshStarted = deferred<AbortSignal>();
  const refreshResult = deferred<void>();
  const otherPage = makePage(makeProject("other", []));
  await signInWith(async (url) => {
    if (!url.endsWith("/projects/project/files/status?ids=private")) throw new Error(`Unexpected request ${url}`);
    return reply;
  });

  try {
    const status = readHook(queryClient, () => useProjectFileStatuses("project", [file]));
    const oldPoll = status.refetch();
    await vi.advanceTimersByTimeAsync(2_000);
    await decoding.started;
    await signInWith(async (url) => { throw new Error(`Unexpected request ${url}`); }, OTHER_USER);
    queryClient.clear();
    const refresh = queryClient.fetchQuery({
      queryKey: projectQueryKey,
      queryFn: async ({ signal }) => {
        refreshStarted.resolve(signal);
        await refreshResult.promise;
        return otherPage;
      },
    });
    const observed = Promise.allSettled([refresh]);
    const signal = await refreshStarted.promise;
    decoding.release();
    await oldPoll;
    await vi.advanceTimersByTimeAsync(0);

    expect(signal.aborted).toBe(false);
    refreshResult.resolve();
    expect(await observed).toEqual([{ status: "fulfilled", value: otherPage }]);
  } finally {
    decoding.release();
    refreshResult.resolve();
    queryClient.clear();
  }
});

it("does not lose an authoritative project refresh when a file finishes parsing", async () => {
  vi.useFakeTimers();
  const pending = makeFile("preexisting");
  const parsed = makeFile(pending.id, "ready");
  const fresh = makePage(makeProject("project", [parsed, makeFile("new-upload")]));
  const stale = makePage(makeProject("project", [pending]));
  const queryClient = new QueryClient();
  const started = deferred<void>();
  const releaseOldRead = deferred<void>();
  await signInWith(async (url) => {
    if (!url.endsWith("/projects/project/files/status?ids=preexisting")) throw new Error(`Unexpected request ${url}`);
    return ok({ items: [{ id: parsed.id, status: parsed.status, errorMessage: null }] });
  });
  queryClient.setQueryData(projectQueryKey, stale);
  let requests = 0;
  const project = new QueryObserver(queryClient, {
    queryKey: projectQueryKey,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      requests += 1;
      if (requests !== 1) return fresh;
      started.resolve();
      await releaseOldRead.promise;
      signal.throwIfAborted();
      return stale;
    },
  });
  const unsubscribe = project.subscribe(() => {});

  try {
    const refresh = queryClient.invalidateQueries({ queryKey: projectQueryKey });
    await started.promise;
    const status = readHook(queryClient, () => useProjectFileStatuses("project", [pending]));
    const poll = status.refetch();
    await vi.advanceTimersByTimeAsync(2_000);
    await poll;
    await refresh;
    releaseOldRead.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(queryClient.getQueryData(projectQueryKey)).toEqual(fresh);
  } finally {
    releaseOldRead.resolve();
    unsubscribe();
    queryClient.clear();
  }
});
