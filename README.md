# ArchFlow（架构决策助手）

ArchFlow 面向学生和独立开发者，帮助用户通过对话明确项目需求、团队规模、预算等条件，结合项目资料形成架构说明和架构图，并继续调整、保存和比较方案。

项目目标与真实进度请先看[项目说明](./specs/项目说明.md)。全部规格入口见[文档导航](./specs/README.md)。

## 当前阶段

截至 2026-11-13，已有登录/工作台界面、基于本机文件的模拟项目与会话操作、共享 Zod 数据定义，以及后端和数据库基础代码。真实账号、业务 API、模型执行、流式回复、可编辑画布和资料检索尚未接通，第一版用户流程尚未验收。

数据库初始迁移有历史真实执行记录；新增运行状态迁移仍需真实数据库复核。具体状态和证据见[待做清单](./specs/待做清单.md)，不能根据页面上的按钮判断功能完成。

## 仓库结构

| 位置              | 职责                                                          |
| ----------------- | ------------------------------------------------------------- |
| `apps/web`        | Next.js 页面、用户交互和前端请求；当前使用模拟数据            |
| `apps/api`        | NestJS 接口、权限、数据库和文件操作；当前主要是启动与基础设施 |
| `packages/agent`  | 模型请求和执行流程；目前为占位代码                            |
| `packages/shared` | Zod 数据定义、共享类型和错误常量                              |
| `packages/db`     | TypeORM 实体与数据库迁移                                      |
| `specs`           | 需求、流程、接口、数据设计、待办和验证记录                    |

前端计划使用 React Flow 编辑图，后端在同一 NestJS 进程内调用 Agent。模型直接使用 OpenAI Node.js SDK 兼容接口；不引入 LangChain、LangGraph 或 Vercel AI SDK。包间依赖使用 `workspace:*`。

## 本地开发

需要 Node.js 20.12+、pnpm 9+。启动数据库等服务还需要 Docker。仓库声明的包管理器版本是 pnpm 9.15.0。

先安装依赖：

```sh
pnpm install
```

### 查看当前前端

```sh
pnpm dev:web
```

打开 [http://localhost:3000](http://localhost:3000)。开发环境可用“一键登录”进入工作台；它只用于查看界面。模拟数据保存在 `apps/web/.mock/db.json`，不会使用 PostgreSQL。新建项目包含示例文件和示例架构资产。

生产模式的真实登录尚未实现，不能把本地演示视为可部署的完整产品。

### 启动后端基础设施

根据[环境变量示例](./.env.example)在仓库根目录创建 `.env`，填写数据库、Redis 与 MinIO 配置。当前 API 优先读取 `apps/api/.env`，不存在时才读取根 `.env`；迁移脚本优先读取根 `.env`。本地建议统一使用根 `.env`，避免两处配置指向不同数据库。

```sh
docker compose up -d
pnpm db:migrate
pnpm dev:api
```

Compose 提供 PostgreSQL/pgvector（5432）、Redis（6379）、MinIO 文件接口（9000）和控制台（9001）。当前 MinIO 使用 `bitnamilegacy/minio:latest`，配置用于本地开发；生产部署需单独制定方案。

API 默认端口为 3001，全局业务前缀为 `/api/v1`。目前尚无业务路由，也未实现 `/health` 和 `/ready`。启动过程会连接数据库，启动成功不代表 Redis、MinIO 或业务功能全部可用。

`JWT_SECRET`、`OPENAI_*`、`NEXT_PUBLIC_API_BASE_URL` 在示例中已有预留，但尚未接入完整认证、模型和前端真实请求流程。填写这些值不会自动启用相关功能。

### 常用命令

| 命令              | 用途                                        |
| ----------------- | ------------------------------------------- |
| `pnpm dev`        | 启动各包开发任务和前后端                    |
| `pnpm dev:web`    | 开发前端并构建其共享依赖                    |
| `pnpm dev:api`    | 开发 API 及相关公共包                       |
| `pnpm dev:agent`  | 监听 Agent 包编译，目前没有可运行的模型逻辑 |
| `pnpm db:migrate` | 执行数据库迁移，会修改所连接数据库          |
| `pnpm test`       | 运行现有 Vitest 测试                        |
| `pnpm typecheck`  | 检查各包 TypeScript 类型                    |
| `pnpm lint`       | 检查代码规范                                |
| `pnpm build`      | 构建全部包与应用                            |

## 开发入口

- 范围和验收：[MVP 需求边界](./specs/mvp.md)。
- 具体开发顺序：[待做清单](./specs/待做清单.md)。
- 实现前的设计缺口：[待确认问题](./specs/待确认问题.md)。
- 前后端调用顺序：[数据流](./specs/数据流.md)。
- 接口字段与行为：[API 文档](./specs/API文档/README.md)，字段定义以 `packages/shared/src/schemas/` 为准。
- 长期开发规则：[AGENTS.md](./AGENTS.md)。

第一版的重点是让真实用户完成“描述需求 → 确认条件 → 生成图 → 调整 → 保存方案”。后续 PDF/DOCX 解析、RabbitMQ 和 Go 服务等扩展见[架构规划](./specs/架构规划.md)。
