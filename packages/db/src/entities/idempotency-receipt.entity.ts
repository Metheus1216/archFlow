import { Column, Entity, Index, Unique } from "typeorm";
import { UuidEntity } from "./base.entity.js";

@Entity({ name: "idempotency_receipts" })
@Unique("uq_idempotency_receipts_scope", ["userId", "scope", "requestKey"])
@Index("idx_idempotency_receipts_expires_at", ["expiresAt"])
export class IdempotencyReceiptEntity extends UuidEntity {
  @Column({ name: "user_id", type: "bigint" })
  userId!: string;

  @Column({ type: "text" })
  scope!: string;

  @Column({ name: "request_key", type: "varchar", length: 64 })
  requestKey!: string;

  @Column({ name: "request_hash", type: "varchar", length: 64 })
  requestHash!: string;

  @Column({ type: "jsonb" })
  response!: Record<string, unknown>;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;
}
