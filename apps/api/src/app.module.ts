import { Module } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { DatabaseModule } from "./database/database.module.js";
import { InfraModule } from "./infra/infra.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import { ZodValidationPipe } from "./common/zod-validation.pipe.js";
import { AgentRunModule } from "./modules/run/agent-run.module.js";

/**
 * AgentRunModule 提供由认证后的会话与运行接口调用的应用服务。
 */
@Module({
  imports: [DatabaseModule, InfraModule, AgentRunModule],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
