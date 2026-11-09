/**
 * @arch-flow/db
 *
 * 数据库层出口。骨架阶段只导出包标识，实体与迁移后续放在：
 *   src/entities/   TypeORM 实体（双主键：内部 BIGINT + 外部 UUID）
 *   src/migrations/ 迁移脚本
 */
export const DB_PACKAGE_NAME = "@arch-flow/db" as const;
