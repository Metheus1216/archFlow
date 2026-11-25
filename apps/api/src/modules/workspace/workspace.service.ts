import {
  AssetEntity,
  ConversationEntity,
  KnowledgeFileEntity,
  MessageEntity,
  ProjectEntity,
  type UuidEntity,
} from "@arch-flow/db";
import {
  Conversation,
  ConversationMeta,
  ERROR_CODES,
  GraphWithLayoutInput,
  Message,
  PageSchema,
  Project,
  ProjectNode,
  PROJECT_TREE_ITEM_LIMIT,
  type CreateConversationInput,
  type CreateProjectInput,
  type MessageListQuery,
  type PaginationQuery,
  type UpdateConversationInput,
  type UpdateProjectInput,
} from "@arch-flow/shared";
import { Inject, Injectable } from "@nestjs/common";
import type { EntityManager, EntityTarget } from "typeorm";
import { z } from "zod";
import { apiError } from "../../common/api-response.js";
import { DatabaseService } from "../../database/database.service.js";
import { writeWorkspaceOnce, type WorkspaceWriteOptions } from "./workspace-idempotency.js";
import { paginateWorkspaceRows } from "./workspace-pagination.js";

const PROJECT_PAGE = PageSchema(ProjectNode);
const CONVERSATION_PAGE = PageSchema(ConversationMeta);
const MESSAGE_PAGE = PageSchema(Message);
const RESOURCE_UUID = z.uuid();
const DEFAULT_CONVERSATION_TITLE = "新会话";
const LAST_MESSAGE_PREVIEW_LENGTH = 80;

const projectNotFound = () => apiError(404, ERROR_CODES.PROJECT_NOT_FOUND, "项目不存在。");
const conversationNotFound = () => apiError(404, ERROR_CODES.CONVERSATION_NOT_FOUND, "会话不存在。");

export const getWorkspaceProject = async (
  manager: EntityManager,
  ownerId: string,
  projectId: string,
  lock?: "pessimistic_read" | "pessimistic_write",
) => {
  if (!RESOURCE_UUID.safeParse(projectId).success) throw projectNotFound();
  const project = await manager.findOne(ProjectEntity, {
    where: { userId: ownerId, uuid: projectId },
    lock: lock ? { mode: lock } : undefined,
  });
  if (!project) throw projectNotFound();
  return project;
};

export const getWorkspaceConversation = async (
  manager: EntityManager,
  ownerId: string,
  conversationId: string,
  write = false,
) => {
  if (!RESOURCE_UUID.safeParse(conversationId).success) throw conversationNotFound();
  const query = manager.getRepository(ConversationEntity)
    .createQueryBuilder("conversation")
    .innerJoin(ProjectEntity, "project", "project.id = conversation.project_id")
    .addSelect("project.uuid", "project_uuid")
    .where("project.user_id = :ownerId", { ownerId })
    .andWhere("conversation.uuid = :conversationId", { conversationId });
  if (write) query.setLock("pessimistic_write", undefined, ["conversation"]);
  const { entities, raw } = await query.getRawAndEntities<{ project_uuid: string }>();
  const conversation = entities[0];
  const projectUuid = raw[0]?.project_uuid;
  if (!conversation || !projectUuid) throw conversationNotFound();
  return { conversation, projectUuid };
};

const toProject = (project: ProjectEntity) => Project.parse({
  id: project.uuid,
  name: project.projectName,
  description: project.description,
  createdAt: project.createdAt.toISOString(),
  updatedAt: project.updatedAt.toISOString(),
});

const toConversationMeta = (conversation: ConversationEntity, projectUuid: string) => ConversationMeta.parse({
  id: conversation.uuid,
  projectId: projectUuid,
  title: conversation.title,
  updatedAt: conversation.updatedAt.toISOString(),
});

const toMessage = (message: MessageEntity) => Message.parse({
  id: message.uuid,
  role: message.role,
  content: message.content,
  graphSnapshot: message.graphSnapshot,
  metadata: message.metadata,
  createdAt: message.createdAt.toISOString(),
});

export const selectWorkspaceMessages = (manager: EntityManager, conversationId: string) => manager.getRepository(MessageEntity)
  .createQueryBuilder("message")
  .where("message.conversation_id = :conversationId", { conversationId })
  .andWhere("message.role IN ('user', 'assistant')");

export const describeWorkspaceConversation = async (
  manager: EntityManager,
  conversation: ConversationEntity,
  projectUuid: string,
) => {
  const baseQuery = selectWorkspaceMessages(manager, conversation.id);
  const messageCount = await baseQuery.getCount();
  const lastMessage = messageCount ? await baseQuery
    .select(["message.uuid", "message.role", "message.content", "message.createdAt"])
    .orderBy("message.created_at", "DESC")
    .addOrderBy("message.id", "DESC").limit(1).getOne() : null;

  return Conversation.parse({
    ...toConversationMeta(conversation, projectUuid),
    draftGraph: conversation.currentDraftGraph,
    draftLayout: conversation.currentDraftLayout ?? undefined,
    draftVersion: conversation.draftVersion,
    messageCount,
    lastMessage: lastMessage ? {
      id: lastMessage.uuid,
      role: lastMessage.role,
      contentPreview: Array.from(lastMessage.content).slice(0, LAST_MESSAGE_PREVIEW_LENGTH).join(""),
      createdAt: lastMessage.createdAt.toISOString(),
    } : null,
    createdAt: conversation.createdAt.toISOString(),
  });
};

const recentProjectRows = async <Row extends UuidEntity & { projectId: string }>(
  manager: EntityManager,
  entity: EntityTarget<Row>,
  projectIds: string[],
  columns: (keyof Row & string)[],
) => {
  const repository = manager.getRepository(entity);
  const query = repository.createQueryBuilder("entry");
  const table = query.escape(repository.metadata.tableName);
  const rows = await query
    .select(["entry.id", "entry.projectId", ...columns.map((column) => `entry.${column}`)])
    .where(`entry.id IN (
    SELECT recent.id
    FROM unnest(CAST(:projectIds AS bigint[])) AS scope(project_id)
    CROSS JOIN LATERAL (
      SELECT child.id FROM ${table} AS child
      WHERE child.project_id = scope.project_id
      ORDER BY child.updated_at DESC, child.id DESC LIMIT :childLimit
    ) AS recent
  )`, { projectIds, childLimit: PROJECT_TREE_ITEM_LIMIT })
    .orderBy("entry.updated_at", "DESC")
    .addOrderBy("entry.id", "DESC")
    .getMany();

  const byProject = new Map<string, Row[]>();
  for (const row of rows) {
    const group = byProject.get(row.projectId);
    if (group) group.push(row);
    else byProject.set(row.projectId, [row]);
  }
  return byProject;
};

@Injectable()
export class WorkspaceService {
  constructor(@Inject(DatabaseService) private readonly database: Pick<DatabaseService, "dataSource">) {}

  listProjects = (ownerId: string, pagination: PaginationQuery) =>
    this.database.dataSource.transaction("REPEATABLE READ", async (manager) => {
      const query = manager.getRepository(ProjectEntity).createQueryBuilder("project")
        .where("project.user_id = :ownerId", { ownerId });
      const page = await paginateWorkspaceRows(query, pagination, "updated_at");
      if (!page.items.length) return PROJECT_PAGE.parse(page);

      const projectIds = page.items.map(({ id }) => id);
      const files = await recentProjectRows(manager, KnowledgeFileEntity, projectIds, [
        "uuid", "fileName", "fileType", "status", "errorMessage", "createdAt",
      ]);
      const assets = await recentProjectRows(manager, AssetEntity, projectIds, ["uuid", "name", "createdAt"]);
      const conversations = await recentProjectRows(manager, ConversationEntity, projectIds, ["uuid", "title", "updatedAt"]);

      return PROJECT_PAGE.parse({
        ...page,
        items: page.items.map((project) => {
          const projectConversations = conversations.get(project.id) ?? [];
          return {
            ...toProject(project),
            lastActiveConversationId: projectConversations[0]?.uuid ?? null,
            files: (files.get(project.id) ?? []).map((file) => ({
              id: file.uuid,
              fileName: file.fileName,
              fileType: file.fileType,
              status: file.status,
              errorMessage: file.errorMessage,
              createdAt: file.createdAt.toISOString(),
            })),
            assets: (assets.get(project.id) ?? []).map((asset) => ({
              id: asset.uuid,
              name: asset.name,
              createdAt: asset.createdAt.toISOString(),
            })),
            conversations: projectConversations.map((conversation) => toConversationMeta(conversation, project.uuid)),
          };
        }),
      });
    });

  createProject = (ownerId: string, input: CreateProjectInput, options: WorkspaceWriteOptions & { key: string }) =>
    this.database.dataSource.transaction((manager) => writeWorkspaceOnce(
      manager,
      { ownerId, scope: "/projects", ...options },
      input,
      Project,
      async () => toProject(await manager.save(ProjectEntity, {
        userId: ownerId,
        projectName: input.name,
        description: input.description ?? null,
      })),
    ));

  getProject = async (ownerId: string, projectId: string) =>
    toProject(await getWorkspaceProject(this.database.dataSource.manager, ownerId, projectId));

  updateProject = (ownerId: string, projectId: string, input: UpdateProjectInput) =>
    this.database.dataSource.transaction(async (manager) => {
      const project = await getWorkspaceProject(manager, ownerId, projectId, "pessimistic_write");
      if (input.name !== undefined) project.projectName = input.name;
      if (input.description !== undefined) project.description = input.description;
      return toProject(await manager.save(ProjectEntity, project));
    });

  listConversations = (ownerId: string, projectId: string, pagination: PaginationQuery) =>
    this.database.dataSource.transaction("REPEATABLE READ", async (manager) => {
      const project = await getWorkspaceProject(manager, ownerId, projectId);
      const query = manager.getRepository(ConversationEntity).createQueryBuilder("conversation")
        .where("conversation.project_id = :projectId", { projectId: project.id });
      const page = await paginateWorkspaceRows(query, pagination, "updated_at");
      return CONVERSATION_PAGE.parse({
        ...page,
        items: page.items.map((conversation) => toConversationMeta(conversation, project.uuid)),
      });
    });

  createConversation = (
    ownerId: string,
    projectId: string,
    input: CreateConversationInput,
    options: WorkspaceWriteOptions,
  ) => this.database.dataSource.transaction(async (manager) => {
    const project = await getWorkspaceProject(manager, ownerId, projectId, "pessimistic_read");
    return writeWorkspaceOnce(
      manager,
      { ownerId, scope: `/projects/${project.uuid}/conversations`, ...options },
      input,
      Conversation,
      async () => {
        const { initialAssetId } = input;
        let initialCanvas: z.infer<typeof GraphWithLayoutInput> | null = null;
        if (initialAssetId) {
          const asset = RESOURCE_UUID.safeParse(initialAssetId).success && await manager.findOneBy(AssetEntity, {
            projectId: project.id,
            uuid: initialAssetId,
          });
          if (!asset) throw apiError(404, ERROR_CODES.ASSET_NOT_FOUND, "资产不存在。");
          initialCanvas = GraphWithLayoutInput.parse({ graph: asset.graphData, layout: asset.graphLayout ?? undefined });
        }

        const saved = await manager.save(ConversationEntity, {
          projectId: project.id,
          title: input.title ?? DEFAULT_CONVERSATION_TITLE,
          currentDraftGraph: initialCanvas?.graph ?? null,
          currentDraftLayout: initialCanvas?.layout ?? null,
        });
        return Conversation.parse({
          ...toConversationMeta(saved, project.uuid),
          draftGraph: saved.currentDraftGraph,
          draftLayout: saved.currentDraftLayout ?? undefined,
          draftVersion: saved.draftVersion,
          messageCount: 0,
          lastMessage: null,
          createdAt: saved.createdAt.toISOString(),
        });
      },
    );
  });

  getConversation = (ownerId: string, conversationId: string) =>
    this.database.dataSource.transaction("REPEATABLE READ", async (manager) => {
      const { conversation, projectUuid } = await getWorkspaceConversation(manager, ownerId, conversationId);
      return describeWorkspaceConversation(manager, conversation, projectUuid);
    });

  renameConversation = (ownerId: string, conversationId: string, { title }: UpdateConversationInput) =>
    this.database.dataSource.transaction(async (manager) => {
      const { conversation, projectUuid } = await getWorkspaceConversation(manager, ownerId, conversationId, true);
      conversation.title = title;
      return toConversationMeta(await manager.save(ConversationEntity, conversation), projectUuid);
    });

  listMessages = (ownerId: string, conversationId: string, pagination: MessageListQuery) =>
    this.database.dataSource.transaction("REPEATABLE READ", async (manager) => {
      const { conversation } = await getWorkspaceConversation(manager, ownerId, conversationId);
      const backward = pagination.direction === "backward";
      const page = await paginateWorkspaceRows(selectWorkspaceMessages(manager, conversation.id), pagination, "created_at", backward ? "DESC" : "ASC");
      const messages = backward ? page.items.reverse() : page.items;
      return MESSAGE_PAGE.parse({ ...page, items: messages.map(toMessage) });
    });
}
