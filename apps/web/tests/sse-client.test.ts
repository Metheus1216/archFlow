import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectRunStream } from "../lib/sse-client";

const STREAM_URL = "/api/mock/runs/run_1/stream";
const FORMAL_STREAM_URL = "/api/v1/runs/run_1/stream";

vi.mock("../lib/api-client", () => ({
  authenticatedFetch: (input: string, init?: RequestInit) => fetch(input, init),
}));

const event = (id: number, data: unknown) =>
  `id: ${id}\ndata: ${JSON.stringify(data)}\n\n`;

const response = (body: string) =>
  new Response(body, { headers: { "content-type": "text/event-stream" } });

const delta = (content: string) => ({
  type: "text-delta",
  messageId: "assistant_1",
  content,
});

const done = {
  type: "done",
  assistantMessageId: "assistant_1",
  finishReason: "stop",
};

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", { removeEventListener: vi.fn() });
});

afterEach(() => vi.unstubAllGlobals());

describe("run stream", () => {
  it("resumes from the last applied event even if the next id had arrived", async () => {
    const fetchStream = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(event(1, delta("先")) + "id: 2\n"))
      .mockResolvedValueOnce(
        response(
          ": heartbeat\n\n" +
            event(1, delta("先")) +
            event(2, delta("后")) +
            event(3, done),
        ),
      );
    vi.stubGlobal("fetch", fetchStream);
    const onFrame = vi.fn();

    await expect(
      connectRunStream(STREAM_URL, {
        signal: new AbortController().signal,
        onFrame,
      }),
    ).resolves.toBe("terminal");

    expect(
      new Headers(fetchStream.mock.calls[1]?.[1]?.headers).get("Last-Event-ID"),
    ).toBe("1");
    expect(onFrame.mock.calls.map(([frame]) => frame)).toEqual([
      delta("先"),
      delta("后"),
      done,
    ]);
  });

  it("rejects an untrusted subscription URL without making a request", async () => {
    const fetchStream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchStream);

    await expect(
      connectRunStream("//other.example/runs/run_1/stream", {
        signal: new AbortController().signal,
        onFrame: vi.fn(),
      }),
    ).rejects.toThrow();

    expect(fetchStream).not.toHaveBeenCalled();
  });

  it("closes the subscription when the server asks for clarification", async () => {
    const pause = {
      type: "interrupt",
      interruptId: "card_1",
      kind: "clarification",
      node: "router",
      payload: { question: "要给什么系统画图？" },
      expiresAt: "2026-11-24T00:00:00.000Z",
    };
    const fetchStream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(event(1, pause)));
    vi.stubGlobal("fetch", fetchStream);
    const onFrame = vi.fn();

    await expect(
      connectRunStream(STREAM_URL, {
        signal: new AbortController().signal,
        onFrame,
      }),
    ).resolves.toBe("waiting_input");

    expect(onFrame).toHaveBeenCalledWith(pause);
    expect(fetchStream).toHaveBeenCalledTimes(1);
  });

  it("accepts only formal replay frames on the v1 stream and sends the last applied cursor", async () => {
    const savedDelta = { ...delta("数据库正文"), replace: true };
    const start = {
      type: "run-start",
      runId: "run_1",
      conversationId: "conversation_1",
      userMessageId: "user_1",
      assistantMessageId: "assistant_1",
      traceId: "trace-123",
    };
    const mockSnapshot = {
      type: "snapshot",
      run: {
        id: "run_1",
        conversationId: "conversation_1",
        userMessageId: "user_1",
        assistantMessageId: "assistant_1",
        status: "succeeded",
        finishReason: "stop",
        createdAt: "2026-11-24T00:00:00.000Z",
        finishedAt: "2026-11-24T00:00:00.000Z",
        error: null,
      },
      assistantMessage: {
        id: "assistant_1",
        role: "assistant",
        content: "Mock 私有快照",
        graphSnapshot: null,
        metadata: null,
        createdAt: "2026-11-24T00:00:00.000Z",
      },
      stage: null,
    };
    const fetchStream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(event(1, delta("正文片段")) + event(2, mockSnapshot)))
      .mockResolvedValueOnce(response(event(3, start) + event(4, savedDelta) + event(5, done)));
    vi.stubGlobal("fetch", fetchStream);
    const onFrame = vi.fn();

    await expect(connectRunStream(FORMAL_STREAM_URL, {
      signal: new AbortController().signal,
      onFrame,
    })).resolves.toBe("terminal");

    expect(new Headers(fetchStream.mock.calls[1]?.[1]?.headers).get("Last-Event-ID")).toBe("1");
    expect(onFrame.mock.calls.map(([frame]) => frame)).toEqual([
      delta("正文片段"), start, savedDelta, done,
    ]);
  });
});
