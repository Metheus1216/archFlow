import { Column, Entity } from "typeorm";
import { UuidEntity, bigintNumberTransformer } from "./base.entity.js";

/** 项目知识库文件（knowledge_base）。pdf / docx 只存储、不解析。 */
@Entity({ name: "knowledge_base" })
export class KnowledgeFileEntity extends UuidEntity {
  @Column({ name: "project_id", type: "bigint" })
  projectId!: string;

  @Column({ name: "file_name", type: "varchar", length: 255 })
  fileName!: string;

  @Column({ name: "file_type", type: "varchar", length: 20 })
  fileType!: string;

  @Column({ name: "mime_type", type: "varchar", length: 100 })
  mimeType!: string;

  @Column({
    name: "file_size",
    type: "bigint",
    default: 0,
    transformer: bigintNumberTransformer,
  })
  fileSize!: number;

  /** 对象存储地址，仅服务端内部使用，不对外返回。 */
  @Column({ name: "file_url", type: "varchar", length: 500 })
  fileUrl!: string;

  @Column({ type: "varchar", length: 20, default: "processing" })
  status!: string;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage!: string | null;
}
