import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { KnowledgeController } from "./knowledge.controller.js";
import { createConfiguredEmbedding, KNOWLEDGE_EMBEDDING } from "./knowledge-embedding.js";
import { KnowledgeService } from "./knowledge.service.js";

@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, { provide: KNOWLEDGE_EMBEDDING, useFactory: createConfiguredEmbedding }],
  exports: [KNOWLEDGE_EMBEDDING],
})
export class KnowledgeModule {}
