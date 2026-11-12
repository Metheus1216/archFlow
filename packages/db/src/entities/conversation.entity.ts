import { Column, Entity } from "typeorm";
import { UuidEntity } from "./base.entity.js";

@Entity({ name: "conversations" })
export class ConversationEntity extends UuidEntity {
  @Column({ name: "project_id", type: "bigint" })
  projectId!: string;

  @Column({ type: "varchar", length: 50, default: "新会话" })
  title!: string;

  /** 当前画布草稿；覆盖更新，历史版本只存在 messages.graph_snapshot。 */
  @Column({ name: "current_draft_graph", type: "jsonb", nullable: true })
  currentDraftGraph!: Record<string, unknown> | null;

  @Column({ name: "draft_version", type: "int", default: 0 })
  draftVersion!: number;
}
