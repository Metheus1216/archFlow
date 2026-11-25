import "reflect-metadata";
import { Logger, RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module.js";
import { getTraceId } from "./common/api-response.js";
import { loadEnv } from "./config/env.js";

const logger = new Logger("Bootstrap");

const bootstrap = async (): Promise<void> => {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader("X-Trace-Id", getTraceId(request));
    next();
  });
  app.setGlobalPrefix("api/v1", {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "ready", method: RequestMethod.GET },
    ],
  });
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    exposedHeaders: ["X-Trace-Id", "Retry-After"],
  });
  app.useBodyParser("json", { limit: "1mb" });
  app.enableShutdownHooks();

  await app.listen(env.PORT, env.HOST);
};

void bootstrap().catch((error: unknown) => {
  logger.error(
    "API 启动失败",
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
