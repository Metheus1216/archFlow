import { Module } from "@nestjs/common";

/**
 * 根模块。骨架阶段只挂空数组，业务模块后续接入：
 *   AuthModule / ProjectModule / ConversationModule /
 *   RunModule / FileModule / AssetModule
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
