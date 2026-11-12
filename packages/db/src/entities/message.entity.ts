import { Column, Entity } from "typeorm";
import { UuidEntity } from "./base.entity.js";

@Entity({ name: "messages" })
export class MessageEntity extends UuidEntity {
  @Column({ name: "conversation_id", type: "bigint" })
  conversationId!: string;

  @Column({ type: "varchar", length: 20 })
  role!: string;

  @Column({ type: "text" })
  content!: string;

  /** 卡片、引用、usage 都随消息持久化，不单独建表。 */
  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: "graph_snapshot", type: "jsonb", nullable: true })
  graphSnapshot!: Record<string, unknown> | null;
}
