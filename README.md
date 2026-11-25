# ArchFlow (架构决策助手)

面向缺乏架构经验的学生和独立开发者的**约束驱动架构决策助手**。把模糊的项目 idea 转化为可调整、可沉淀、可复用的架构方案。

## 🎯 一、 MVP (最小可行性产品) 边界

**核心目标**：跑通“输入 Idea → AI 追问约束 → 生成架构图 → 用户微调 → 保存为资产”的端到端单机闭环。
**产品边界**：每个项目仅供其所有者使用。多人协作已退出产品路线，详见[架构规划](specs/架构规划.md#0-总览)。

### ✅ MVP 必须要做的功能：
1. **Auth 认证**：邮箱密码登录、注册，基于 Redis 的双 Token 无感刷新。
2. **侧边栏管理**：新建项目、项目树渲染，支持新建 / 重命名 / 删除会话，以及删除项目、知识库文件与资产；当无项目时显示全局引导页（Empty State）。
3. **Agent 对话**：原生 SSE 流式输出，大模型基于约束推演方案，并抛出交互卡片。
4. **卡片交互**：用户点选卡片（支持自定义输入）后原地变灰，Agent 继续推流。
5. **React Flow 画布**：渲染图数据，支持拖拽、Dagre 自动布局、防抖乐观锁保存。
6. **项目资料问答**：支持上传 `.md` / `.txt` 文件，后端切片存入 `pgvector`，助手能基于文档回答。图片可上传并查看解析状态；生成图片内容描述、入库和检索另见 `P1-04`。
7. **资产与回溯**：保存当前画布为资产；基于历史消息恢复快照或物理复制开启新分支。

### ❌ MVP 明确**不做**的功能：
1. **重格式解析**：PDF / DOCX 仅上传存储、不解析；图片属于 MVP 范围，可上传并解析（以 `specs/mvp.md` 与 API 能力矩阵为准）。
2. **异步队列**：MVP 不使用 BullMQ / RabbitMQ，纯靠 Node 异步流直推；post-MVP 统一用 RabbitMQ，不引入 BullMQ。
3. **复杂 Agent 框架**：不引入 LangChain/LangGraph，采用手写状态机 + 原生 Function Calling。
4. **微服务拆分**：MVP 所有业务逻辑放在 NestJS 单体；post-MVP 只拆一个 Go 文档解析服务，不做整体微服务。

---

## 🚀 二、 技术栈 (纯原生白盒架构)

本项目追求极致的工程透明度，**抛弃了重型 AI 封装框架**，全部采用原生 API 和自研状态机。

### 🎨 前端 (apps/web)
- **核心框架**：Next.js (App Router)，本地工作台在浏览器恢复登录后加载项目与会话。
- **样式与 UI**：Tailwind CSS + Shadcn/ui + 系统字体栈。
- **状态管理**：Zustand (客户端状态) + TanStack Query (服务端状态与缓存、乐观更新)。
- **分屏布局**：`react-resizable-panels` (会话区与画布区可拖拽调节宽度，布局比例通过 `autoSaveId` 自动持久化)。
- **核心画布**：React Flow (`@xyflow/react`) + Dagre (计算节点坐标自动布局)。
- **流式通信**：`@microsoft/fetch-event-source` (基于 fetch，可带 Authorization 与 `Last-Event-ID`，支持断线重试；不手写 SSE 解析，无 AI SDK 依赖)。
- **契约校验**：Zod (表单验证 + SSE 事件流解析校验)。

### ⚙️ 后端 (apps/api)
- **核心框架**：NestJS (ESM 规范) + TypeORM (ORM)。
- **数据库**：PostgreSQL + pgvector (存关系型业务数据与向量检索)。
- **缓存与凭证**：Redis (存双 Token 无感刷新状态、防刷限流)。
- **对象存储**：MinIO (兼容 S3 协议，存用户上传的文本 / 图片 / PDF / DOCX 文件)。
- **模型接入**：OpenAI 兼容 Node.js SDK 直连模型接口；主链路用 DeepSeek chat，图片理解与 Embedding 用千问；`packages/agent/src/llm/` 做 Provider 适配，不绑定单一供应商。
- **接口安全**：全局 Zod 验证管道、全局异常过滤器 (ErrorResponse)、TraceId 链路追踪。

### 🧠 Agent 核心引擎 (packages/agent)
- **意图识别**：同一个输入入口，按整句规则、意图样例向量、LLM 结构化判断依次匹配。向量层优先处理明确的读请求，模型结合近期消息、约束与画布补全复杂请求。
- **执行方式**：明确的单任务直接调用对应能力。复合任务先生成短计划，再按顺序执行。读写画布和查资料是显式能力，图数据经 `GraphInput` 校验后才提交。
- **澄清与恢复**：信息缺失时暂停，保留原任务和已知约束。下一条澄清回答从检查点继续。标题和推荐问题在答案结束后单独生成。
- **模型接入**：通过原生 OpenAI SDK 获取结构化结果并用 Zod 校验。解释、知识问答和通用聊天支持直接流式输出正文。业务状态、画布版本与项目资料由运行服务提供。

### 🏗️ 基础设施与工程化 (Infra & DevOps)
- **包管理与构建**：pnpm Workspaces + Turborepo (Monorepo 架构)。
- **本地基础设施**：Docker Compose (一键拉起 PostgreSQL + Redis + MinIO)。
- **生产环境部署**：
  - **服务器**：自有云服务器 (Linux)。
  - **容器化**：前后端及基础设施全部使用 Docker 打包。
  - **反向代理**：Nginx (负责静态资源分发、HTTPS 证书配置、以及为 SSE 配置长连接 `proxy_read_timeout`)。
  - **CI/CD**：GitHub Actions (通过 SSH 自动拉取代码并执行 `docker compose up -d --build`)。
- **测试体系**：Vitest (前后端统一) + Supertest (后端接口测试)。
- **未来扩展（post-MVP）**：RabbitMQ + 一个 Go 文档解析服务；只拆专用计算服务，不引入 BullMQ，不做整体微服务。

---

## 📁 三、 Monorepo 结构 (Turborepo + pnpm)

```text
arch-flow/
├── .agents/                        # AI 辅助开发用的 Skill 配置
├── apps/
│   ├── web/                        # 【Next.js 前端】
│   │   ├── app/                    # 页面路由 (登录、工作台)
│   │   ├── components/
│   │   │   ├── workspace/
│   │   │   │   ├── sidebar/        # 侧边栏、项目树、会话列表
│   │   │   │   ├── chat/           # 聊天区、约束卡片
│   │   │   │   ├── canvas/         # React Flow 画布
│   │   │   │   └── workspace-view.tsx  # 可拖拽分屏容器
│   │   │   ├── project/            # 项目创建入口
│   │   │   └── ui/                 # Shadcn/ui 基础组件
│   │   ├── hooks/                  # TanStack Query 数据钩子
│   │   ├── lib/
│   │   │   ├── sse-client.ts       # ★ SSE 连接封装 (@microsoft/fetch-event-source)
│   │   │   ├── api-client.ts       # 全局 Fetch 封装与契约校验
│   │   │   └── mock-*.ts           # 本地 Mock 数据层
│   │   ├── store/                  # Zustand 全局状态
│   │   └── package.json
│   └── api/                        # 【NestJS 后端】
│       ├── src/
│       │   ├── modules/            
│       │   │   ├── auth/           # 认证 (双 Token)
│       │   │   ├── project/        # 项目树骨架
│       │   │   ├── conversation/   # 会话、消息、草稿
│       │   │   ├── run/            # Agent 任务生命周期
│       │   │   ├── file/           # 文件解析 (MinIO)
│       │   │   └── asset/          # 架构资产
│       │   ├── common/             # 全局异常过滤器、Zod 验证
│       │   └── main.ts
│       └── package.json
├── packages/
│   ├── agent/                      # 【Agent 核心引擎】
│   │   ├── src/
│   │   │   ├── engine.ts           # ★ 手写 while 循环 / 状态机
│   │   │   ├── state.ts            # 约束与画布状态
│   │   │   ├── tools/              # 原生工具 (查 pgvector)
│   │   │   ├── prompts/            # 手写系统提示词
│   │   │   └── llm/                # 原生 SDK 封装
│   │   └── package.json
│   ├── db/                         # 【数据库层】
│   │   ├── src/
│   │   │   ├── entities/           # TypeORM 实体 (9 张核心表)
│   │   │   └── migrations/         # 迁移脚本
│   │   └── package.json
│   └── shared/                     # 【前后端共享契约】
│       ├── src/
│       │   └── schemas/            # ★ Zod Schema
│       └── package.json
├── specs/                          # 团队开发文档 (API、数据流、DB)
├── docker-compose.yml              # 本地跑 PG / Redis / MinIO
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## 🌊 四、 正式 API 数据流摘要

以下是 `/api/v1` 的目标流程。完整契约见 [数据流](specs/数据流.md)。

认证与无感刷新：AccessToken 过期返回 `401 TOKEN_EXPIRED`。前端用 HttpOnly Cookie 里的 RefreshToken 静默刷新，成功后重发原请求一次。

冷启动与空状态：无项目返回空列表（`items: []`），前端渲染引导页；有项目则拉取 ProjectNode 树，并自动加载最近活跃的会话。

新建项目与会话：点击“新建项目”调 POST /api/v1/projects，成功后自动调 POST /api/v1/projects/:projectId/conversations 创建首个空会话；进入项目后，侧边栏“历史会话”右侧的 + 也会调用该接口为新会话创建空白画布。

SSE 流式推演：POST /api/v1/conversations/:conversationId/messages 返回 202 + runId，再用 GET /api/v1/runs/:runId/stream 取流；收到 run-start 建空气泡；依次接收 status、text-delta、graph 实时渲染；最后 done + [DONE] 结束。断线时用 `Last-Event-ID` 续传；缓冲失效后服务端按 `runId` 查库合成快照重放，前端再拉消息列表校准。

约束卡片交互：SSE 推 constraint-card，用户作答后调 POST /api/v1/conversations/:conversationId/messages/:messageId/answer，后端更新状态并推 card-updated，继续推流；重复提交幂等重放。

乐观锁防抖保存：拖拽画布防抖 3 秒后，带 baseVersion 调 PUT /api/v1/conversations/:conversationId/draft。版本不一致返回 409 冲突。

资产懒加载：保存资产不返回图；点击资产时调 GET /api/v1/projects/:projectId/assets/:assetId?includeGraph=true 懒加载渲染。

文件上传与解析：上传后 text / image 进入解析（processing → ready / failed），pdf / docx 直接 stored；Agent 只引用 ready 的文件。

历史分支与回溯：基于消息开启新分支，调 POST /api/v1/conversations/:conversationId/fork，后端物理复制历史记录并关联画布快照。

## 🛠️ 五、 快速开始

### 本地工作台体验

准备 Node.js 20.12+、pnpm 9+ 和支持 Web Locks 的浏览器，例如新版 Chrome 或 Edge。从仓库根目录启动，使用终端给出的 `localhost` 地址访问。

```sh
pnpm install
pnpm dev:web
```

1. 注册本地账号，退出后用同一邮箱登录。新账号进入空态引导页。从项目树新建项目和会话，刷新后仍可打开。
2. 在新会话发送「画个架构图」，选择卡片选项或输入自定义回答。同一条助手消息继续生成，文字分段出现，架构图保存后显示在右侧画布。
3. 分别生成两张图。可用消息下的「查看这次的架构图」查看历史快照，右侧画布继续显示最新草稿。生成过程中也可尝试断网重连或停止生成。
4. 给订单服务画图后发送「给订单查询加缓存，再解释改完的流程」。等画布显示查询缓存，再在第一张图对应的消息下点「用这张图提问」，发送「请求怎么走？」。聊天区解读第一张图，右侧继续显示带缓存的草稿。
5. 拖动右侧节点，等状态显示「已保存」后刷新，核对位置。点「自动布局」也会保存。两个标签页同时编辑时，可在发生冲突的页面点击「读取最新画布」。
6. 点击画布的「导出 → 保存为项目资产」，输入名称并保存。在左侧「资产库」点开这份资产，查看保存时的图和节点位置。刷新工作台后可以再次打开。
7. 在旧消息的「…」菜单选择「恢复快照」，确认后右侧显示旧图并重新排列节点，原聊天记录仍可查看。选择「从此开启新会话」，可带着这条消息及之前的对话和当时的架构图继续。左侧可以切换两个会话，各自的草稿分别保存。
8. 准备一份内容为「缓存 TTL 为 47 秒。」的 `缓存规范.md`，在当前项目的「知识库 → 上传资料」上传。看到「可引用」后问「根据《缓存规范.md》，缓存 TTL 是多少？」。答案下方的「参考资料」显示匹配的原文，刷新后仍可查看。图片只检查能否读取；PDF 和 DOCX 仅存储。

默认由本地演示助手回答，项目资料问答按文件名和关键词查找同项目原文，无需模型密钥或数据库。数据保存在 Web 应用的 `.mock` 目录，设置 `ARCHFLOW_MOCK_DIR` 可使用单独目录。继续体验或复测的步骤见 [接手说明](specs/Agent架构讨论交接.md#5-本地体验与正式验收)。

### 真实模型预览

把以下服务端变量写入 `apps/web/.env.local`，再启动 `pnpm dev:web`。

```dotenv
ARCHFLOW_PREVIEW_AGENT=1
OPENAI_API_KEY=你的模型服务密钥
OPENAI_MODEL=支持 JSON 对象输出和流式对话的模型名
# 使用 OpenAI 兼容服务时设置，例如 https://你的服务/v1
OPENAI_BASE_URL=
# 配置后启用意图样例向量匹配
OPENAI_EMBEDDING_MODEL=
```

预览沿用本地登录、数据与 SSE。完成一张图后发送「解释当前架构图」，可体验模型正文逐段返回。生成和修改图时，先校验模型的结构化结果，再发送说明与已保存的图。真实模型预览尚未接入本地资料检索；体验带引用的问答请使用默认演示助手。正式入库和检索见 [待做清单](specs/待做清单.md#2-p0mvp-主链路)。

### 本地生产构建预览

运行 `pnpm build:web`，然后用 `MOCK_API=1 pnpm start:web` 启用本地 Mock。PowerShell 可运行 `$env:MOCK_API='1'; pnpm start:web`。生产部署保持 Mock API 的默认关闭状态。

### 正式接口本地联调

安装 Docker，在仓库根目录把 `.env.example` 复制为 `.env`，填入随机生成的 `JWT_SECRET`。如需使用聊天和项目文本检索，同时配置支持 JSON 输出与流式回答的 Chat 模型和输出 1536 维向量的 Embedding 模型。密钥只写到服务端环境。

在 `apps/web/.env.local` 设置 `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/api/v1`。在仓库根目录依次启动：

```sh
docker compose up -d
pnpm db:migrate
pnpm dev
```

打开 `http://localhost:3000`。检查 API 的 `/health` 和 `/ready` 后，可按 [验收清单](specs/mvp.md#四验收标准)运行对应流程。若改动 Web 端口或域名，同时设置 API 的 `WEB_ORIGIN`；浏览器使用 `localhost` 或 HTTPS 以启用刷新 Cookie 和 Web Locks。正式入口使用 NestJS、PostgreSQL、Redis 和 MinIO。删除入口待落地软删除策略。 [待做清单](specs/待做清单.md)

Compose 的 MinIO 使用 `bitnamilegacy/minio:latest` 供本地开发。

## 👥 六、 团队协作规范
主干开发：main 分支始终可运行。每次 push 走 PR，至少 1 人 Review 才能合并。

契约驱动：所有接口字段必须先改 packages/shared 里的 Zod Schema，再改代码。

决策记录：工程问题记录到 `specs/DECISIONS.md`，架构演进与服务边界记录到 `specs/架构规划.md`，可执行事项记录到 `specs/待做清单.md`。
