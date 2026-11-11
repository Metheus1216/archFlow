import { Column, Entity } from "typeorm";
import { UuidEntity } from "./base.entity.js";

@Entity({ name: "runs" })
export class RunEntity extends UuidEntity {
  @Column({ name: "conversation_id", type: "bigint" })
  conversationId!: string;

  @Column({ name: "user_message_id", type: "bigint" })
  userMessageId!: string;

  @Column({ name: "assistant_message_id", type: "bigint" })
  assistantMessageId!: string;

  @Column({ type: "varchar", length: 20, default: "queued" })
  status!: string;

  @Column({ name: "finish_reason", type: "varchar", length: 20, nullable: true })
  finishReason!: string | null;

  @Column({ type: "jsonb", nullable: true })
  usage!: Record<string, unknown> | null;

  @Column({ name: "error_code", type: "varchar", length: 64, nullable: true })
  errorCode!: string | null;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage!: string | null;

  @Column({ name: "finished_at", type: "timestamptz", nullable: true })
  finishedAt!: Date | null;
}
