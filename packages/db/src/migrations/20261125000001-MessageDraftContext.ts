import type { MigrationInterface, QueryRunner } from "typeorm";

export class MessageDraftContext20261125000001 implements MigrationInterface {
  name = "MessageDraftContext20261125000001";

  up = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query("ALTER TABLE messages ADD COLUMN draft_graph_context jsonb");
  };

  down = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query("ALTER TABLE messages DROP COLUMN draft_graph_context");
  };
}
