import { Controller, Get } from "@nestjs/common";
import { ERROR_CODES, type HealthResult } from "@arch-flow/shared";
import { setTimeout } from "node:timers/promises";
import { apiError } from "../../common/api-response.js";
import { DatabaseService } from "../../database/database.service.js";
import { RedisService } from "../../infra/redis.service.js";
import { StorageService } from "../../infra/storage.service.js";

const HEALTHY = { status: "ok" } satisfies HealthResult;
const READY_TIMEOUT_MS = 2_000;

@Controller()
export class SystemController {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  @Get("health")
  health(): HealthResult {
    return HEALTHY;
  }

  @Get("ready")
  async ready(): Promise<HealthResult> {
    const timer = new AbortController();
    try {
      const check = async () => {
        if (this.redis.client.status !== "ready") return false;
        try {
          const [, pong, hasBucket] = await Promise.all([
            this.database.dataSource.query("SELECT 1"),
            this.redis.client.ping(),
            this.storage.client.bucketExists(this.storage.bucket),
          ]);
          return pong === "PONG" && hasBucket;
        } catch {
          return false;
        }
      };
      const ready = await Promise.race([
        check(),
        setTimeout(READY_TIMEOUT_MS, false, { ref: false, signal: timer.signal }),
      ]);
      if (ready) return HEALTHY;
    } finally {
      timer.abort();
    }
    throw apiError(503, ERROR_CODES.SERVICE_UNAVAILABLE, "服务依赖暂未就绪");
  }
}
