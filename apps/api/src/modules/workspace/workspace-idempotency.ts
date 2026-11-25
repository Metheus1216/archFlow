import { createHash } from "node:crypto";
import { IdempotencyReceiptEntity } from "@arch-flow/db";
import { ERROR_CODES, TraceId } from "@arch-flow/shared";
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { z } from "zod";
import { apiError } from "../../common/api-response.js";
import { DatabaseService } from "../../database/database.service.js";

const RECEIPT_LIFETIME_MS = 24 * 60 * 60_000;
const RECEIPT_CLEANUP_INTERVAL_MS = 60 * 60_000;
const RECEIPT_CLEANUP_LIMIT = 1_000;

export type WorkspaceWriteOptions = { key?: string; traceId: string };

export const writeWorkspaceOnce = async <Result>(
  manager: EntityManager,
  { ownerId, scope, key, traceId }: WorkspaceWriteOptions & { ownerId: string; scope: string },
  input: unknown,
  schema: z.ZodType<Result>,
  write: () => Promise<Result>,
): Promise<{ data: Result; traceId: string }> => {
  if (!key) return { data: await write(), traceId };

  const lockId = createHash("sha256")
    .update(JSON.stringify([ownerId, scope, key]))
    .digest()
    .readBigInt64BE()
    .toString();
  const [lock] = await manager.query<{ acquired: boolean }[]>(
    "SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired",
    [lockId],
  );
  if (!lock?.acquired) {
    throw apiError(409, ERROR_CODES.IDEMPOTENCY_IN_PROGRESS, "该请求正在处理，请稍后重试。");
  }

  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const identity = { userId: ownerId, scope, requestKey: key };
  const receipt = await manager.findOne(IdempotencyReceiptEntity, {
    where: identity,
    lock: { mode: "pessimistic_write" },
  });
  if (receipt && receipt.expiresAt.getTime() > Date.now()) {
    if (receipt.requestHash !== requestHash) {
      throw apiError(422, ERROR_CODES.IDEMPOTENCY_KEY_REUSED, "该请求键已用于不同的请求，请更换请求键后重试。");
    }

    return z.object({ data: schema, traceId: TraceId }).parse(receipt.response);
  }

  const data = await write();
  await manager.save(IdempotencyReceiptEntity, {
    ...identity,
    id: receipt?.id,
    requestHash,
    response: { data, traceId },
    expiresAt: new Date(Date.now() + RECEIPT_LIFETIME_MS),
  });
  return { data, traceId };
};

@Injectable()
export class WorkspaceReceiptCleanup implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkspaceReceiptCleanup.name);
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(private readonly database: DatabaseService) {}

  onApplicationBootstrap = () => this.schedule();

  onApplicationShutdown = () => {
    this.stopped = true;
    clearTimeout(this.timer);
  };

  private schedule = () => {
    if (!this.stopped) {
      this.timer = setTimeout(() => void this.prune(), RECEIPT_CLEANUP_INTERVAL_MS);
      this.timer.unref();
    }
  };

  private prune = async () => {
    try {
      await this.database.dataSource.query(`
        DELETE FROM idempotency_receipts WHERE id IN (
          SELECT id FROM idempotency_receipts
          WHERE expires_at <= CURRENT_TIMESTAMP
          ORDER BY expires_at
          LIMIT $1 FOR UPDATE SKIP LOCKED
        )
      `, [RECEIPT_CLEANUP_LIMIT]);
    } catch (error) {
      this.logger.warn("清理已过期的幂等回执失败", error instanceof Error ? error.message : undefined);
    } finally {
      this.schedule();
    }
  };
}
