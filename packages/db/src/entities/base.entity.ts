import {
  Column,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * 双主键公共列（§表设计「其他」）：
 * - `id` 为内部 BIGINT 自增，仅库内 JOIN / 索引使用，不出现在响应；
 * - `uuid` 为对外 ID，API 响应里的 `id` 取这个值。
 */
export abstract class UuidEntity {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ type: "uuid", unique: true, default: () => "gen_random_uuid()" })
  uuid!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}

/** PostgreSQL BIGINT 经 pg 驱动会以字符串返回；文件大小等场景统一转回 number。 */
export const bigintNumberTransformer = {
  to: (value: number): number => value,
  from: (value: string | number): number => Number(value),
};
