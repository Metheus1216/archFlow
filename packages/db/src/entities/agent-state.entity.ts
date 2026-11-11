import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/** Agent 级结构化记忆：每个会话只保留最新一条（conversation_id 唯一）。 */
@Entity({ name: "agent_states" })
export class AgentStateEntity {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "conversation_id", type: "bigint", unique: true })
  conversationId!: string;

  @Column({ name: "current_step", type: "varchar", length: 50 })
  currentStep!: string;

  @Column({ name: "constraints_data", type: "jsonb", nullable: true })
  constraintsData!: Record<string, unknown> | null;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
