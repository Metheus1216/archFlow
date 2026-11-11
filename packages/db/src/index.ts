/**
 * @arch-flow/db
 *
 * 数据库层出口：TypeORM 实体、DataSource 工厂与迁移脚本。
 * API 侧只通过这里拿实体和 DataSource，不直接依赖 typeorm 的配置细节。
 */
export const DB_PACKAGE_NAME = "@arch-flow/db" as const;

export * from "./entities/index.js";
export * from "./data-source.js";
