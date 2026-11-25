import { AgentExecutionError, createOpenAIEmbedding } from "@arch-flow/agent";
import { ERROR_CODES, KNOWLEDGE_EMBEDDING_DIMENSIONS } from "@arch-flow/shared";
import { loadEnv } from "../../config/env.js";

export const KNOWLEDGE_EMBEDDING = Symbol("KNOWLEDGE_EMBEDDING");

export const createConfiguredEmbedding = () => {
  const env = loadEnv();
  const apiKey = env.OPENAI_EMBEDDING_API_KEY ?? env.OPENAI_API_KEY;
  if (!env.OPENAI_EMBEDDING_MODEL || !apiKey) return null;
  return createOpenAIEmbedding({
    apiKey,
    baseURL: env.OPENAI_EMBEDDING_BASE_URL ?? env.OPENAI_BASE_URL,
    model: env.OPENAI_EMBEDDING_MODEL,
  });
};

export const serializeKnowledgeVector = (vector: number[]) => {
  if (
    vector.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS ||
    !vector.every(Number.isFinite) ||
    !vector.some((value) => value !== 0)
  ) throw new AgentExecutionError(ERROR_CODES.SERVICE_UNAVAILABLE, "向量模型返回的维度或数值与知识库不匹配。");
  return JSON.stringify(vector);
};
