import { DataSource } from "typeorm";
import { entities } from "./entities/index.js";
import { InitialSchema20261111000000 } from "./migrations/20261111000000-InitialSchema.js";

/**
 * 唯一的 DataSource 构造入口：API 与迁移脚本共用，避免两处配置漂移。
 * `synchronize` 永远为 false，schema 变更只能走迁移。
 */
export const createDataSource = (url: string): DataSource =>
  new DataSource({
    type: "postgres",
    url,
    entities,
    migrations: [InitialSchema20261111000000],
    migrationsTableName: "migrations",
    synchronize: false,
    migrationsRun: false,
    logging: false,
  });
