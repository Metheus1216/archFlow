import { Column, Entity } from "typeorm";
import { UuidEntity } from "./base.entity.js";

/** 架构资产：保存固化的画布。 */
@Entity({ name: "assets" })
export class AssetEntity extends UuidEntity {
  @Column({ name: "project_id", type: "bigint" })
  projectId!: string;

  @Column({ type: "varchar", length: 50 })
  name!: string;

  @Column({ name: "graph_data", type: "jsonb" })
  graphData!: Record<string, unknown>;
}
