import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 初始 schema：表设计中的 9 张表 + 索引 + pgvector 扩展。
 *
 * 注意：
 * - `documents_chunks.embedding` 必须是 `vector(1536)`，HNSW 索引依赖 pgvector；
 * - 表名 / 列名与 TypeORM 实体保持一致，`synchronize` 永远关闭，迁移是唯一建表入口；
 * - `messages.metadata` 用 GIN 索引支撑按 cardId 定位卡片。
 */
export class InitialSchema20261111000000 implements MigrationInterface {
  name = "InitialSchema20261111000000";

  up = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE EXTENSION IF NOT EXISTS vector;

      CREATE TABLE "users" (
        "id" BIGSERIAL NOT NULL,
        "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
        "email" VARCHAR(255) NOT NULL,
        "username" VARCHAR(15) NOT NULL,
        "password_hash" VARCHAR(255) NOT NULL,
        "avatar_url" VARCHAR(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_uuid" UNIQUE ("uuid"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      );

      CREATE TABLE "projects" (
        "id" BIGSERIAL NOT NULL,
        "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
        "user_id" BIGINT NOT NULL,
        "project_name" VARCHAR(20) NOT NULL,
        "description" VARCHAR(200),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_projects" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_projects_uuid" UNIQUE ("uuid"),
        CONSTRAINT "FK_projects_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_projects_user_id" ON "projects" ("user_id");

      CREATE TABLE "knowledge_base" (
        "id" BIGSERIAL NOT NULL,
        "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
        "project_id" BIGINT NOT NULL,
        "file_name" VARCHAR(255) NOT NULL,
        "file_type" VARCHAR(20) NOT NULL,
        "mime_type" VARCHAR(100) NOT NULL,
        "file_size" BIGINT NOT NULL DEFAULT 0,
        "file_url" VARCHAR(500) NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'processing',
        "error_message" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_base" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_knowledge_base_uuid" UNIQUE ("uuid"),
        CONSTRAINT "FK_knowledge_base_project" FOREIGN KEY ("project_id")
          REFERENCES "projects" ("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_knowledge_base_project_id" ON "knowledge_base" ("project_id");

      CREATE TABLE "documents_chunks" (
        "id" BIGSERIAL NOT NULL,
        "project_id" BIGINT NOT NULL,
        "knowledge_id" BIGINT NOT NULL,
        "content" TEXT NOT NULL,
        "embedding" vector(1536) NOT NULL,
        "metadata" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_documents_chunks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_documents_chunks_project" FOREIGN KEY ("project_id")
          REFERENCES "projects" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_documents_chunks_knowledge" FOREIGN KEY ("knowledge_id")
          REFERENCES "knowledge_base" ("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_documents_chunks_knowledge_id" ON "documents_chunks" ("knowledge_id");
      CREATE INDEX "IDX_documents_chunks_embedding_hnsw" ON "documents_chunks"
        USING hnsw ("embedding" vector_cosine_ops);

      CREATE TABLE "assets" (
        "id" BIGSERIAL NOT NULL,
        "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
        "project_id" BIGINT NOT NULL,
        "name" VARCHAR(50) NOT NULL,
        "graph_data" JSONB NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_assets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_assets_uuid" UNIQUE ("uuid"),
        CONSTRAINT "FK_assets_project" FOREIGN KEY ("project_id")
          REFERENCES "projects" ("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_assets_project_updated" ON "assets" ("project_id", "updated_at" DESC);

      CREATE TABLE "conversations" (
        "id" BIGSERIAL NOT NULL,
        "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
        "project_id" BIGINT NOT NULL,
        "title" VARCHAR(50) NOT NULL DEFAULT '新会话',
        "current_draft_graph" JSONB,
        "draft_version" INT NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_conversations_uuid" UNIQUE ("uuid"),
        CONSTRAINT "FK_conversations_project" FOREIGN KEY ("project_id")
          REFERENCES "projects" ("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_conversations_project_updated" ON "conversations"
        ("project_id", "updated_at" DESC);

      CREATE TABLE "messages" (
        "id" BIGSERIAL NOT NULL,
        "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" BIGINT NOT NULL,
        "role" VARCHAR(20) NOT NULL,
        "content" TEXT NOT NULL,
        "metadata" JSONB,
        "graph_snapshot" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_messages" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_messages_uuid" UNIQUE ("uuid"),
        CONSTRAINT "FK_messages_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations" ("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_messages_conversation_created" ON "messages"
        ("conversation_id", "created_at" DESC);
      CREATE INDEX "IDX_messages_metadata_gin" ON "messages" USING GIN ("metadata");

      CREATE TABLE "runs" (
        "id" BIGSERIAL NOT NULL,
        "uuid" UUID NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" BIGINT NOT NULL,
        "user_message_id" BIGINT NOT NULL,
        "assistant_message_id" BIGINT NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
        "finish_reason" VARCHAR(20),
        "usage" JSONB,
        "error_code" VARCHAR(64),
        "error_message" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "finished_at" TIMESTAMPTZ,
        CONSTRAINT "PK_runs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_runs_uuid" UNIQUE ("uuid"),
        CONSTRAINT "FK_runs_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_runs_user_message" FOREIGN KEY ("user_message_id")
          REFERENCES "messages" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_runs_assistant_message" FOREIGN KEY ("assistant_message_id")
          REFERENCES "messages" ("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_runs_conversation_created" ON "runs"
        ("conversation_id", "created_at" DESC);

      CREATE TABLE "agent_states" (
        "id" BIGSERIAL NOT NULL,
        "conversation_id" BIGINT NOT NULL,
        "current_step" VARCHAR(50) NOT NULL,
        "constraints_data" JSONB,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_states" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_states_conversation" UNIQUE ("conversation_id"),
        CONSTRAINT "FK_agent_states_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversations" ("id") ON DELETE CASCADE
      );
    `);
  };

  down = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "agent_states";
      DROP TABLE IF EXISTS "runs";
      DROP TABLE IF EXISTS "messages";
      DROP TABLE IF EXISTS "conversations";
      DROP TABLE IF EXISTS "assets";
      DROP TABLE IF EXISTS "documents_chunks";
      DROP TABLE IF EXISTS "knowledge_base";
      DROP TABLE IF EXISTS "projects";
      DROP TABLE IF EXISTS "users";
    `);
  };
}
