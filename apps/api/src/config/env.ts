import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * 环境变量是进程启动的第一道外部输入，用 Zod 统一校验。
 * 默认值只服务于本地开发；生产必须显式提供 DATABASE_URL / REDIS_URL / MinIO 凭证。
 */
const BooleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.string().min(1).default("http://localhost:3000"),

  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://archflow:archflow@localhost:5432/archflow"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  MINIO_ENDPOINT: z.string().min(1).default("localhost"),
  MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  MINIO_USE_SSL: BooleanString,
  MINIO_ACCESS_KEY: z.string().min(1).default("minioadmin"),
  MINIO_SECRET_KEY: z.string().min(1).default("minioadmin"),
  MINIO_BUCKET: z.string().min(1).default("archflow"),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | null = null;

const configDir = dirname(fileURLToPath(import.meta.url));

/**
 * 本地开发优先读 apps/api/.env，其次读仓库根 .env；
 * 生产环境由容器注入，文件不存在时跳过。
 * 要求 Node >= 20.12（process.loadEnvFile）。
 */
const ENV_FILES = [
  resolve(configDir, "../../.env"),
  resolve(configDir, "../../../../.env"),
];

const loadDotEnv = (): void => {
  const envFile = ENV_FILES.find((path) => existsSync(path));

  if (envFile) {
    loadEnvFile(envFile);
  }
};

/** 进程内只解析一次；测试需要切换 env 时调用 resetEnvCache。 */
export const loadEnv = (): Env => {
  if (!cachedEnv) {
    loadDotEnv();
    cachedEnv = EnvSchema.parse(process.env);
  }

  return cachedEnv;
};

export const resetEnvCache = (): void => {
  cachedEnv = null;
};
