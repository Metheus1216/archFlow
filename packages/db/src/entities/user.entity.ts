import { Column, Entity } from "typeorm";
import { UuidEntity } from "./base.entity.js";

@Entity({ name: "users" })
export class UserEntity extends UuidEntity {
  @Column({ type: "varchar", length: 255, unique: true })
  email!: string;

  @Column({ type: "varchar", length: 15 })
  username!: string;

  @Column({ name: "password_hash", type: "varchar", length: 255 })
  passwordHash!: string;

  @Column({ name: "avatar_url", type: "varchar", length: 255, nullable: true })
  avatarUrl!: string | null;
}
