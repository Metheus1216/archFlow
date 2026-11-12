import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * P0-01 运行态与 HITL 契约：
 * - `runs.metadata` 存当前 `Interrupt` 与工具调用摘要；
 * - `agent_states.version` 作乐观锁，配合“同一会话单活跃 run”防止并发覆盖。
 */
export class RunMetadataAndAgentStateVersion20261112000000
  implements MigrationInterface
{
  name = "RunMetadataAndAgentStateVersion20261112000000";

  up = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      ALTER TABLE "runs"
        ADD COLUMN "metadata" JSONB;

      ALTER TABLE "agent_states"
        ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
    `);
  };

  down = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      ALTER TABLE "agent_states"
        DROP COLUMN IF EXISTS "version";

      ALTER TABLE "runs"
        DROP COLUMN IF EXISTS "metadata";
    `);
  };
}
