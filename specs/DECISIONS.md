# 架构决策记录

## 2026-11-09 · 文档契约收敛

1. **唯一约束源**：字段长度、格式、枚举取值以《10. 数据模型（Zod）》为准；API 文档只描述协议与语义，不重复数值。冲突时以 Zod 为准。
2. **长度口径**：`limit ≤ 50`、项目 `description ≤ 200`、会话 `title ≤ 50`、资产 `name ≤ 50`；Zod 与数据库列一并收敛。
3. **文件类型与解析范围**：`text`（.md/.txt/.markdown）与 `image`（.png/.jpg/.jpeg/.webp）可上传且可解析；`pdf` / `docx` 仅上传存储，不解析、不可被 Agent 引用，上传后 `status = stored`。
4. **refreshToken 传输**：refreshToken 只放 `httpOnly; Secure; SameSite=Lax` Cookie，通过 `Set-Cookie` 下发；`/auth/refresh` 与 `/auth/logout` 从 Cookie 读取，不在请求体 / 响应体收发。补 CSRF 校验与 CORS `Allow-Credentials`。
5. **卡片重复提交**：同一卡片再次提交返回 `200` 并重放首次的 run 结果（幂等），不返回 `409 CARD_ALREADY_ANSWERED`。
6. **system 消息**：仅后端使用，`GET /messages` 过滤，不下发前端。
7. **画布自动保存**：前端停手 **3 秒** 后保存，服务端单会话限流建议 ≤ 2 次/秒。
8. **202 受理态**：发送消息与提交卡片回答的 202 响应统一 `status = queued`；取消接口为异步，返回当前状态，终态通过流或轮询获得。
9. **图错误按原因映射**：序列化超过 `GRAPH_MAX_BYTES` → `413 GRAPH_TOO_LARGE`；结构 / 嵌套深度非法 → `422 GRAPH_INVALID`（草稿与资产一致）。Zod 侧由 `GraphInput` 的 `params` 标记 + `mapGraphError()` 统一映射，全局异常过滤器调用。
10. **输入归一化**：邮箱 `Email` 先 trim + 转小写再校验，存储 / 唯一性 / 登录比对均用归一化值；昵称、项目名、标题、资产名、消息内容、卡片 `values` 等文本字段先 trim 再计长度。
11. **`streamUrl` 服务端生成**：由 `runStreamUrl(runId)` 唯一入口生成，前端原样使用、不得拼接；响应模型用正则校验形态。
12. **唯一源范围**：Q1「以 Zod 为准」只覆盖**字段级**长度 / 格式 / 枚举；协议与行为常量（token TTL、SSE 缓冲 10 分钟、防抖 3 秒、文件 20MB 上限）仍写在 API 文档，不搬进 Zod。
13. **断线恢复以数据库为准**：SSE 断开不终止 run；生成中把累积文本按节流写入 `messages.content`，终态最终写入。事件缓冲（MVP 进程内存，TTL 10 分钟）只用于逐帧重放；缓冲失效时按 `runId` 查 `runs` / `messages` 合成快照（`run-start` + 全量 `text-delta` + 当前 `graph` + `done`）重放，`409 RUN_NOT_RESUMABLE` 仅用于关联消息缺失等数据异常。
14. **SSE 客户端选型**：前端统一使用 `@microsoft/fetch-event-source`（基于 fetch，可携带 `Authorization` / `Last-Event-ID`，内置重试），不手写 SSE 解析，不使用原生 `EventSource`；仍禁止 `@ai-sdk/react` / Vercel AI SDK。
