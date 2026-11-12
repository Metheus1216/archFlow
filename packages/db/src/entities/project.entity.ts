import { Column, Entity } from "typeorm";
import { UuidEntity } from "./base.entity.js";

@Entity({ name: "projects" })
export class ProjectEntity extends UuidEntity {
  @Column({ name: "user_id", type: "bigint" })
  userId!: string;

  @Column({ name: "project_name", type: "varchar", length: 20 })
  projectName!: string;

  @Column({ type: "varchar", length: 200, nullable: true })
  description!: string | null;
}
