import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

/** RAG 文本切片与向量（documents_chunks）。内部表，无对外 uuid。 */
@Entity({ name: "documents_chunks" })
export class DocumentChunkEntity {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  /** 冗余 project_id，保证向量检索必须带项目隔离。 */
  @Column({ name: "project_id", type: "bigint" })
  projectId!: string;

  @Column({ name: "knowledge_id", type: "bigint" })
  knowledgeId!: string;

  @Column({ type: "text" })
  content!: string;

  /**
   * pgvector 列。TypeORM 以字符串读写 `[0.1,0.2,...]`，
   * 相似度检索由 RAG 模块走 `embedding <=> $1` 原生 SQL。
   */
  @Column({ type: "vector", length: 1536 })
  embedding!: string;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
