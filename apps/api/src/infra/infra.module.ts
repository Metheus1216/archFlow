import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service.js";
import { StorageService } from "./storage.service.js";

@Global()
@Module({
  providers: [RedisService, StorageService],
  exports: [RedisService, StorageService],
})
export class InfraModule {}
