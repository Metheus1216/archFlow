import { ERROR_CODES, Graph, SSE_DONE, type RunStatus, type SseFrame } from "@arch-flow/shared";
import { runException, type RunSnapshot } from "./run-store.js";

const REPLAY_TTL_MS = 10 * 60_000;
const MAX_BUFFERED_RUNS = 128;
const MAX_FRAMES_PER_RUN = 512;
export const RESULT_FRAME_LIMIT = 8;

type Frame = SseFrame | typeof SSE_DONE;
type Event = { id: number; frame: Frame };
type Listener = (event: Event) => void;
type Journal = {
  sequence: number;
  events: Event[];
  listeners: Set<Listener>;
  settled?: RunStatus;
  touched: number;
};

const runStart = (snapshot: RunSnapshot, traceId: string, resume?: true): Frame => ({
  type: "run-start",
  runId: snapshot.run.id,
  conversationId: snapshot.run.conversationId,
  userMessageId: snapshot.run.userMessageId,
  assistantMessageId: snapshot.run.assistantMessageId,
  traceId: snapshot.traceId ?? traceId,
  ...(resume ? { resume } : {}),
});

const resultFrames = ({ run, message, interrupt }: RunSnapshot): Frame[] => {
  const frames: Frame[] = [
    { type: "text-delta", messageId: message.id, content: message.content, replace: true },
  ];
  if (message.metadata?.citations?.length)
    frames.push({ type: "citation", sources: message.metadata.citations });
  const graph = Graph.safeParse(message.graphSnapshot);
  if (graph.success) frames.push({ type: "graph", graph: graph.data, replace: true });
  if (message.metadata?.card)
    frames.push({ type: "constraint-card", messageId: message.id, card: message.metadata.card });
  if (message.metadata?.usage) frames.push({ type: "usage", ...message.metadata.usage });
  if (interrupt) frames.push({ type: "interrupt", ...interrupt });
  if (run.error) {
    frames.push({
      type: "error",
      ...run.error,
      retryable: run.error.code !== ERROR_CODES.AGENT_GRAPH_REFERENCE_READ_ONLY,
    });
  }
  if (run.finishReason) {
    frames.push({ type: "done", assistantMessageId: message.id, finishReason: run.finishReason }, SSE_DONE);
  }
  return frames;
};

const isActive = (status: RunStatus) => status === "queued" || status === "running";

export class RunEvents {
  private readonly journals = new Map<string, Journal>();

  sequence = (runId: string) => this.journals.get(runId)?.sequence ?? 0;

  begin = (snapshot: RunSnapshot, traceId: string, resume?: true) => {
    const journal = this.get(snapshot.run.id, snapshot.streamSequence);
    journal.events = [];
    journal.settled = undefined;
    this.append(journal, runStart(snapshot, traceId, resume));
    if (snapshot.message.metadata?.card) {
      this.append(journal, {
        type: "constraint-card",
        messageId: snapshot.message.id,
        card: snapshot.message.metadata.card,
      });
    }
  };

  publish = (runId: string, frame: SseFrame) => {
    const journal = this.journals.get(runId);
    if (journal && journal.settled === undefined) this.append(journal, frame);
  };

  settle = (snapshot: RunSnapshot, traceId: string) => {
    if (isActive(snapshot.run.status)) return;
    const journal = this.get(snapshot.run.id);
    if (journal.settled === snapshot.run.status) return;
    if (!journal.events.length || journal.settled !== undefined) {
      journal.events = [];
      journal.sequence = Math.max(journal.sequence, snapshot.streamSequence);
      this.append(journal, runStart(snapshot, traceId));
    }
    journal.settled = snapshot.run.status;
    for (const frame of resultFrames(snapshot)) this.append(journal, frame);
  };

  subscribe = (snapshot: RunSnapshot, traceId: string, cursor: number | undefined, listener: Listener) => {
    const runId = snapshot.run.id;
    this.prune();
    const cached = this.journals.get(runId);
    if (cursor !== undefined && cached && cursor > cached.sequence)
      throw runException(409, ERROR_CODES.RUN_NOT_RESUMABLE, "续接位置无效，请刷新会话");

    const journal = cached ?? this.get(runId, Math.max(cursor ?? 0, snapshot.streamSequence));
    const staleCycle = journal.settled === "waiting_input" &&
      (snapshot.run.status === "queued" || snapshot.run.status === "canceled" || snapshot.run.status === "failed");
    const first = journal.events[0];
    const lostPrefix = first && (first.frame === SSE_DONE || first.frame.type !== "run-start");
    const needsSnapshot = !first || staleCycle || (lostPrefix && (cursor ?? 0) < first.id - 1) ||
      (journal.settled !== undefined && cursor !== undefined && cursor >= (journal.events.at(-1)?.id ?? 0));

    let backlog: Event[];
    if (needsSnapshot) {
      const frames = [runStart(snapshot, traceId), ...resultFrames(snapshot)];
      backlog = frames.map((frame) => ({ id: ++journal.sequence, frame }));
      if (!first || staleCycle) {
        journal.events = backlog;
        journal.settled = isActive(snapshot.run.status) ? undefined : snapshot.run.status;
      }
    } else {
      backlog = journal.events.filter(({ id }) => cursor === undefined || id > cursor);
    }
    journal.touched = Date.now();
    journal.listeners.add(listener);
    return { backlog, unsubscribe: () => journal.listeners.delete(listener) };
  };

  private get = (runId: string, floor = 0): Journal => {
    this.prune();
    const existing = this.journals.get(runId);
    if (existing) return existing;
    const journal: Journal = { sequence: floor, events: [], listeners: new Set(), touched: Date.now() };
    this.journals.set(runId, journal);
    return journal;
  };

  private prune = () => {
    const cutoff = Date.now() - REPLAY_TTL_MS;
    for (const [runId, journal] of this.journals) {
      if (journal.listeners.size || journal.settled === undefined) continue;
      if (journal.touched <= cutoff || this.journals.size >= MAX_BUFFERED_RUNS)
        this.journals.delete(runId);
    }
  };

  private append = (journal: Journal, frame: Frame) => {
    const event = { id: ++journal.sequence, frame };
    journal.touched = Date.now();
    journal.events.push(event);
    if (journal.events.length > MAX_FRAMES_PER_RUN) journal.events.shift();
    for (const listener of journal.listeners) listener(event);
  };
}
