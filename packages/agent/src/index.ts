/**
 * @arch-flow/agent
 *
 * Agent 核心引擎出口。骨架阶段只导出包标识。
 *
 * 约束：手写 while 循环 / 状态机 + 原生 OpenAI SDK，
 * 禁止引入 LangChain / LangGraph / Vercel AI SDK。
 */
export const AGENT_PACKAGE_NAME = "@arch-flow/agent" as const;
