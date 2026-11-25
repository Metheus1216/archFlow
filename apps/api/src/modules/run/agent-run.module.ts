import { Module } from "@nestjs/common";
import { createAgentEngine, createOpenAIAdapter, type AgentEmbedding } from "@arch-flow/agent";
import { loadEnv } from "../../config/env.js";
import { DatabaseService } from "../../database/database.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { KNOWLEDGE_EMBEDDING } from "../knowledge/knowledge-embedding.js";
import { KnowledgeModule } from "../knowledge/knowledge.module.js";
import { AgentRunController } from "./agent-run.controller.js";
import { AgentRunService, RUN_ENGINE } from "./agent-run.service.js";
import { createKnowledgeSearch } from "./knowledge-search.js";

@Module({
  imports: [AuthModule, KnowledgeModule],
  controllers: [AgentRunController],
  providers: [
    {
      provide: RUN_ENGINE,
      inject: [DatabaseService, KNOWLEDGE_EMBEDDING],
      useFactory: (database: DatabaseService, embedding: AgentEmbedding | null) => {
        const env = loadEnv();
        if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) return null;

        const { model } = createOpenAIAdapter({
          chat: {
            apiKey: env.OPENAI_API_KEY,
            model: env.OPENAI_MODEL,
            baseURL: env.OPENAI_BASE_URL,
          },
        });
        const embed = embedding ?? undefined;
        return createAgentEngine({
          model,
          embed,
          searchKnowledge: createKnowledgeSearch(database.dataSource, embed),
        });
      },
    },
    AgentRunService,
  ],
  exports: [AgentRunService],
})
export class AgentRunModule {}
