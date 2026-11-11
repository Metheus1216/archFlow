import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { createDataSource } from "@arch-flow/db";
import type { DataSource } from "typeorm";
import { loadEnv } from "../config/env.js";

/**
 * 全进程唯一的 TypeORM DataSource。
 *
 * 不引入 @nestjs/typeorm：P0 只需要一个受生命周期管理的连接，
 * 后续业务模块直接注入本服务调用 `dataSource.getRepository(...)`，
 * 避免多一层动态模块和额外的包依赖。
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  readonly dataSource: DataSource;

  constructor() {
    this.dataSource = createDataSource(loadEnv().DATABASE_URL);
  }

  onModuleInit = async (): Promise<void> => {
    if (this.dataSource.isInitialized) {
      return;
    }

    await this.dataSource.initialize();
    this.logger.log("PostgreSQL 已连接");
  };

  onApplicationShutdown = async (): Promise<void> => {
    if (!this.dataSource.isInitialized) {
      return;
    }

    await this.dataSource.destroy();
  };
}
