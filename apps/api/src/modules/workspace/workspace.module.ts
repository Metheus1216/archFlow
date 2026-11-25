import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { WorkspaceCanvasController } from "./workspace-canvas.controller.js";
import { WorkspaceCanvasService } from "./workspace-canvas.service.js";
import { WorkspaceController } from "./workspace.controller.js";
import { WorkspaceReceiptCleanup } from "./workspace-idempotency.js";
import { WorkspaceService } from "./workspace.service.js";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [WorkspaceController, WorkspaceCanvasController],
  providers: [WorkspaceService, WorkspaceCanvasService, WorkspaceReceiptCleanup],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
