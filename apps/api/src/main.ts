import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { loadEnv } from "./config/env.js";

const logger = new Logger("Bootstrap");

const bootstrap = async (): Promise<void> => {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api/v1");
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  });
  app.enableShutdownHooks();

  await app.listen(env.PORT);
};

void bootstrap().catch((error: unknown) => {
  logger.error(
    "API 启动失败",
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
