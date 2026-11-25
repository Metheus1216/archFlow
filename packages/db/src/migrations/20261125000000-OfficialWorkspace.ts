import type { MigrationInterface, QueryRunner } from "typeorm";

export class OfficialWorkspace20261125000000 implements MigrationInterface {
  name = "OfficialWorkspace20261125000000";

  up = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN registration_key_digest varchar(64) UNIQUE,
        ADD COLUMN registration_trace_id varchar(64),
        ADD COLUMN registration_session_issued boolean NOT NULL DEFAULT false;

      ALTER TABLE conversations ADD COLUMN current_draft_layout jsonb;
      ALTER TABLE assets ADD COLUMN graph_layout jsonb;

      CREATE TABLE idempotency_receipts (
        id BIGSERIAL PRIMARY KEY,
        uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scope text NOT NULL,
        request_key varchar(64) NOT NULL,
        request_hash varchar(64) NOT NULL,
        response jsonb NOT NULL,
        expires_at timestamptz NOT NULL,
        CONSTRAINT uq_idempotency_receipts_scope UNIQUE (user_id, scope, request_key)
      );
      CREATE INDEX idx_idempotency_receipts_expires_at ON idempotency_receipts (expires_at);
    `);
  };

  down = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      DROP TABLE idempotency_receipts;
      ALTER TABLE assets DROP COLUMN graph_layout;
      ALTER TABLE conversations DROP COLUMN current_draft_layout;
      ALTER TABLE users
        DROP COLUMN registration_session_issued,
        DROP COLUMN registration_trace_id,
        DROP COLUMN registration_key_digest;
    `);
  };
}
