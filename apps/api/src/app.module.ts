import { Module } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { DatabaseModule } from "./database/database.module.js";
import { InfraModule } from "./infra/infra.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import { ZodValidationPipe } from "./common/zod-validation.pipe.js";

/**
 * 根模块。P0 只接入基础设施与全局管道/过滤器：
 * - DatabaseModule：TypeORM DataSource；
 * - InfraModule：Redis / MinIO；
 * - APP_PIPE / APP_FILTER：所有 Controller 自动生效。
 *
 * 业务模块（Auth / Project / Conversation / Run / File / Asset）在 P1+ 接入。
 */
@Module({
  imports: [DatabaseModule, InfraModule],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
