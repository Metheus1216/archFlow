/**
 * TODO: 基于 @microsoft/fetch-event-source 的 SSE 连接封装。
 *
 * 选型（见 specs/DECISIONS.md 第 14 条）：
 *   - 使用 fetch-event-source，不手写 ReadableStream 解析；
 *   - 不得使用原生 EventSource（无法携带 Authorization 头）；
 *   - 不得使用 @ai-sdk/react / Vercel AI SDK。
 *
 * 计划实现：
 *   - connectRunStream(streamUrl, { signal, lastEventId, onFrame })
 *   - 自动携带 Authorization / Last-Event-ID
 *   - 401 静默刷新后重连；409 / 404 终止；5xx / 网络错误指数退避（最多 3 次）
 *   - 每帧 id 持久化到 sessionStorage: `lastEventId:${runId}`
 *   - openWhenHidden: true
 */
export {};
