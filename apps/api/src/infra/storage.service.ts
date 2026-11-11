import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Client } from "minio";
import { loadEnv } from "../config/env.js";

/**
 * MinIO 客户端：P7 的文件上传走这里。
 * bucket 在启动时就绪；MinIO 暂不可用时只告警，不阻塞 API 启动。
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  readonly client: Client;
  readonly bucket: string;

  constructor() {
    const env = loadEnv();

    this.bucket = env.MINIO_BUCKET;
    this.client = new Client({
      endPoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: env.MINIO_USE_SSL,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
    });
  }

  onModuleInit = (): void => {
    void this.ensureBucket();
  };

  private readonly ensureBucket = async (): Promise<void> => {
    try {
      const exists = await this.client.bucketExists(this.bucket);

      if (!exists) {
        await this.client.makeBucket(this.bucket);
      }

      this.logger.log(`MinIO bucket 就绪：${this.bucket}`);
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message || error.name
          : String(error);

      this.logger.warn(
        `MinIO 暂不可用，文件上传相关接口会失败：${reason}`,
      );
    }
  };
}
