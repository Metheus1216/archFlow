import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { Redis } from "ioredis";
import { loadEnv } from "../config/env.js";

/**
 * Redis 客户端：P1 的 refreshToken 轮转、限流都从这里取。
 * 连接失败只记录日志，不阻塞 HTTP 启动；首次使用时由 ioredis 自动重连。
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor() {
    this.client = new Redis(loadEnv().REDIS_URL, {
      maxRetriesPerRequest: 2,
    });

    this.client.on("error", (error: Error) => {
      this.logger.error(`Redis 连接异常：${error.message}`);
    });
  }

  onApplicationShutdown = async (): Promise<void> => {
    if (this.client.status === "end") {
      return;
    }

    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  };
}
