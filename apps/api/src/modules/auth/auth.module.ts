import { Module } from "@nestjs/common";
import { AuthOriginGuard } from "./auth-origin.guard.js";
import { AuthController } from "./auth.controller.js";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import { RefreshSessions } from "./refresh-sessions.js";

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, AuthOriginGuard, RefreshSessions],
  exports: [AuthGuard, AuthService],
})
export class AuthModule {}
