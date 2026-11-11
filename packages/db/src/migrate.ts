import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createDataSource } from "./data-source.js";

const DEFAULT_DATABASE_URL =
  "postgres://archflow:archflow@localhost:5432/archflow";

const distDir = dirname(fileURLToPath(import.meta.url));

/** 依次尝试仓库根 .env、apps/api/.env、packages/db/.env。 */
const ENV_FILES = [
  resolve(distDir, "../../../.env"),
  resolve(distDir, "../../../apps/api/.env"),
  resolve(distDir, "../.env"),
];

const loadDotEnv = (): void => {
  const envFile = ENV_FILES.find((path) => existsSync(path));

  if (envFile) {
    process.loadEnvFile(envFile);
  }
};

const run = async (): Promise<void> => {
  loadDotEnv();

  const dataSource = createDataSource(
    process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  );

  await dataSource.initialize();

  try {
    const applied = await dataSource.runMigrations({ transaction: "all" });

    if (applied.length === 0) {
      console.log("数据库已是最新，无需迁移");
      return;
    }

    console.log(`已执行迁移：${applied.map((migration) => migration.name).join(", ")}`);
  } finally {
    await dataSource.destroy();
  }
};

void run().catch((error: unknown) => {
  console.error("迁移失败", error);
  process.exitCode = 1;
});
