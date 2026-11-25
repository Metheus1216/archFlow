import { randomUUID } from "node:crypto";
import { AssetEntity, ConversationEntity, MessageEntity } from "@arch-flow/db";
import {
  Asset,
  AssetMeta,
  CreateConversationInput,
  ERROR_CODES,
  FORK_MESSAGE_LIMIT,
  ForkResult,
  LooseGraph,
  MessageMetadata,
  PageSchema,
  SaveDraftResult,
  type AssetInput,
  type AssetListQuery,
  type ForkInput,
  type SaveDraftInput,
} from "@arch-flow/shared";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { apiError } from "../../common/api-response.js";
import { DatabaseService } from "../../database/database.service.js";
import { writeWorkspaceOnce, type WorkspaceWriteOptions } from "./workspace-idempotency.js";
import { paginateWorkspaceRows } from "./workspace-pagination.js";
import { describeWorkspaceConversation, getWorkspaceConversation, getWorkspaceProject, selectWorkspaceMessages } from "./workspace.service.js";

const ASSET_PAGE = PageSchema(AssetMeta);
const RESOURCE_UUID = z.uuid();
const STORED_DRAFT_CONTEXT = z.object({ graph: LooseGraph.nullable() });
const FORK_TITLE_SUFFIX = "（分叉）";

const draftConflict = () => apiError(409, ERROR_CODES.DRAFT_VERSION_CONFLICT, "画布已有更新，请读取已保存的草稿。");

const describeAsset = (asset: AssetEntity) => AssetMeta.parse({
  id: asset.uuid,
  name: asset.name,
  createdAt: asset.createdAt.toISOString(),
  updatedAt: asset.updatedAt.toISOString(),
});

const readHistoricalDraft = (messages: MessageEntity[]) => {
  const snapshot = messages.findLast(({ graphSnapshot, draftGraphContext }) => graphSnapshot !== null || draftGraphContext !== null);
  if (!snapshot) return null;
  return snapshot.graphSnapshot ?? STORED_DRAFT_CONTEXT.parse(snapshot.draftGraphContext).graph;
};

const copyForkMessage = (message: MessageEntity, conversationId: string) => {
  const uuid = randomUUID();
  const metadata = MessageMetadata.nullable().parse(message.metadata);
  if (metadata?.card) {
    metadata.card.id = randomUUID();
    metadata.card.messageId = uuid;
    if (metadata.card.status === "pending") metadata.card.status = "expired";
  }

  return {
    uuid,
    conversationId,
    role: message.role,
    content: message.content,
    metadata,
    graphSnapshot: message.graphSnapshot,
    draftGraphContext: message.draftGraphContext,
    createdAt: message.createdAt,
  };
};

@Injectable()
export class WorkspaceCanvasService {
  constructor(@Inject(DatabaseService) private readonly database: Pick<DatabaseService, "dataSource">) {}

  saveDraft = (ownerId: string, conversationId: string, input: SaveDraftInput) =>
    this.database.dataSource.transaction(async (manager) => {
      const { conversation } = await getWorkspaceConversation(manager, ownerId, conversationId, true);
      if (conversation.draftVersion !== input.baseVersion) throw draftConflict();
      const draftVersion = input.baseVersion + 1;
      const updatedAt = new Date();
      const update = await manager.update(ConversationEntity, {
        id: conversation.id,
        draftVersion: input.baseVersion,
      }, {
        currentDraftGraph: input.graph,
        currentDraftLayout: input.layout ?? null,
        draftVersion,
        updatedAt,
      });
      if (update.affected !== 1) throw draftConflict();
      return SaveDraftResult.parse({ draftVersion, updatedAt: updatedAt.toISOString() });
    });

  saveAsset = (
    ownerId: string,
    projectId: string,
    input: AssetInput,
    options: WorkspaceWriteOptions & { key: string },
  ) => this.database.dataSource.transaction(async (manager) => {
    const project = await getWorkspaceProject(manager, ownerId, projectId, "pessimistic_read");
    return writeWorkspaceOnce(
      manager,
      { ownerId, scope: `/projects/${project.uuid}/assets`, ...options },
      input,
      AssetMeta,
      async () => describeAsset(await manager.save(AssetEntity, {
        projectId: project.id,
        name: input.name,
        graphData: input.graph,
        graphLayout: input.layout ?? null,
      })),
    );
  });

  listAssets = (ownerId: string, projectId: string, pagination: AssetListQuery) =>
    this.database.dataSource.transaction("REPEATABLE READ", async (manager) => {
      const project = await getWorkspaceProject(manager, ownerId, projectId);
      const query = manager.getRepository(AssetEntity).createQueryBuilder("asset")
        .select(["asset.id", "asset.uuid", "asset.name", "asset.createdAt", "asset.updatedAt"])
        .where("asset.project_id = :projectId", { projectId: project.id });
      const page = await paginateWorkspaceRows(query, pagination, "updated_at");
      return ASSET_PAGE.parse({ ...page, items: page.items.map(describeAsset) });
    });

  getAsset = (ownerId: string, projectId: string, assetId: string, includeGraph: boolean) =>
    this.database.dataSource.transaction("REPEATABLE READ", async (manager) => {
      const project = await getWorkspaceProject(manager, ownerId, projectId);
      const asset = RESOURCE_UUID.safeParse(assetId).success && await manager.findOne(AssetEntity, {
        where: { projectId: project.id, uuid: assetId },
        select: includeGraph ? undefined : ["uuid", "name", "createdAt", "updatedAt"],
      });
      if (!asset) throw apiError(404, ERROR_CODES.ASSET_NOT_FOUND, "资产不存在。");
      const meta = describeAsset(asset);
      if (!includeGraph) return meta;
      return Asset.parse({ ...meta, graph: asset.graphData, layout: asset.graphLayout ?? undefined });
    });

  forkConversation = (
    ownerId: string,
    conversationId: string,
    input: ForkInput,
    options: WorkspaceWriteOptions & { key: string },
  ) => this.database.dataSource.transaction(async (manager) => {
    const { conversation, projectUuid } = await getWorkspaceConversation(manager, ownerId, conversationId);
    return writeWorkspaceOnce(
      manager,
      { ownerId, scope: `/conversations/${conversation.uuid}/fork`, ...options },
      input,
      ForkResult,
      async () => {
        const lockedSource = await getWorkspaceConversation(manager, ownerId, conversation.uuid, true);
        const { sourceMessageId } = input;
        const source = RESOURCE_UUID.safeParse(sourceMessageId).success && await selectWorkspaceMessages(manager, conversation.id)
          .andWhere("message.uuid = :sourceMessageId", { sourceMessageId })
          .getOne();
        if (!source) throw apiError(404, ERROR_CODES.MESSAGE_NOT_FOUND, "消息不属于当前会话。");
        const messages = await selectWorkspaceMessages(manager, conversation.id)
          .andWhere(`(message.created_at, message.id) <= (
            SELECT source.created_at, source.id FROM messages AS source WHERE source.id = :sourceId
          )`, { sourceId: source.id })
          .orderBy("message.created_at", "ASC")
          .addOrderBy("message.id", "ASC")
          .limit(FORK_MESSAGE_LIMIT + 1)
          .getMany();
        if (messages.length > FORK_MESSAGE_LIMIT) {
          throw apiError(422, ERROR_CODES.VALIDATION_FAILED, `一次最多复制 ${FORK_MESSAGE_LIMIT} 条消息，请选择更早的消息。`);
        }

        const sourceTitle = lockedSource.conversation.title;
        const titleLimit = CreateConversationInput.shape.title.unwrap().maxLength ?? sourceTitle.length + FORK_TITLE_SUFFIX.length;
        const title = sourceTitle.slice(0, titleLimit - FORK_TITLE_SUFFIX.length).replace(/[\uD800-\uDBFF]$/u, "") + FORK_TITLE_SUFFIX;
        const record = await manager.save(ConversationEntity, {
          projectId: conversation.projectId,
          title,
          currentDraftGraph: readHistoricalDraft(messages),
          currentDraftLayout: null,
        });
        await manager.save(MessageEntity, messages.map((message) => copyForkMessage(message, record.id)));
        const result = await describeWorkspaceConversation(manager, record, projectUuid);
        return ForkResult.parse({ ...result, forkedFrom: { conversationId: conversation.uuid, sourceMessageId: source.uuid } });
      },
    );
  });
}
