import "server-only";

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  CreateConversationInput,
  ERROR_CODES,
  FORK_MESSAGE_LIMIT,
  Message,
  MockAccountId,
  MockDatabase,
  PROJECT_TREE_ITEM_LIMIT,
  type AssetBrief,
  type AssetInput,
  type AssetMeta,
  type Conversation,
  type ConversationBrief,
  type CreateProjectInput,
  type FileBrief,
  type ForkInput,
  type MessageListQuery,
  type MockAssetRecord,
  type MockConversationRecord,
  type MockFileRecord,
  type MockGraph,
  type MockStoredMessage,
  type Page,
  type Project,
  type ProjectNode,
  type SaveDraftInput,
  type SaveDraftResult,
  type SendMessageInput,
} from "@arch-flow/shared";
import { getMockDir, readMockJson, withMockFileWrite, writeMockJson } from "./mock-files";
import { discardMockUpload } from "./mock-upload-storage";
import {
  getHistoricalDraft,
  getRunConversation,
  makeUserMessage,
  MockRunError,
  updateConversationMessages,
} from "./mock-run-data";

const CREATE_KEY_TTL_MS = 24 * 60 * 60 * 1000;
const getUserMockPath = (userId: string) =>
  path.join(getMockDir(), "users", `${MockAccountId.parse(userId)}.json`);
const emptyDatabase = () => MockDatabase.parse({ projects: [], conversations: [] });

export const readMockDatabase = (userId: string): Promise<MockDatabase> =>
  readMockJson(getUserMockPath(userId), MockDatabase, emptyDatabase);

export const updateMockDatabase = async <T>(
  userId: string,
  mutate: (database: MockDatabase) => T | Promise<T>,
): Promise<T> => {
  const filePath = getUserMockPath(userId);
  return withMockFileWrite(filePath, async () => {
    const database = await readMockJson(filePath, MockDatabase, emptyDatabase);
    const result = await mutate(database);
    await writeMockJson(filePath, MockDatabase, database);
    return result;
  });
};

/** 新建项目时种入的示例资产画布，用于验证“从资产开新会话”。 */
const DEFAULT_ASSET_GRAPH: MockGraph = {
  nodes: [
    {
      id: "node-client",
      kind: "client",
      eyebrow: "客户端",
      label: "Web / App",
      meta: "用户入口",
      left: 16,
      top: 50,
    },
    {
      id: "node-gateway",
      kind: "gateway",
      eyebrow: "接入层",
      label: "API Gateway",
      meta: "鉴权 / 限流",
      left: 40,
      top: 50,
    },
    {
      id: "node-service",
      kind: "service",
      eyebrow: "应用层",
      label: "核心服务",
      meta: "领域逻辑",
      left: 64,
      top: 30,
    },
    {
      id: "node-database",
      kind: "database",
      eyebrow: "存储层",
      label: "PostgreSQL",
      meta: "主数据",
      left: 84,
      top: 52,
    },
    {
      id: "node-cache",
      kind: "cache",
      eyebrow: "存储层",
      label: "Redis",
      meta: "热点缓存",
      left: 64,
      top: 74,
    },
  ],
  edges: [
    { id: "edge-client-gateway", path: "M 16 50 L 40 50" },
    { id: "edge-gateway-service", path: "M 40 50 L 64 30" },
    { id: "edge-service-db", path: "M 64 30 L 84 52" },
    { id: "edge-gateway-cache", path: "M 40 50 L 64 74" },
  ],
};

const toConversationBrief = (
  conversation: MockConversationRecord,
): ConversationBrief => ({
  id: conversation.id,
  title: conversation.title,
  updatedAt: conversation.updatedAt,
});

export const toMockConversation = (
  conversation: MockConversationRecord,
): Conversation => ({
  id: conversation.id,
  projectId: conversation.projectId,
  title: conversation.title,
  draftGraph: conversation.draftGraph,
  draftLayout: conversation.draftLayout,
  draftVersion: conversation.draftVersion,
  messageCount: conversation.messageCount,
  lastMessage: conversation.lastMessage,
  createdAt: conversation.createdAt,
  updatedAt: conversation.updatedAt,
});

const toFileBrief = (file: MockFileRecord): FileBrief => ({
  id: file.id,
  fileName: file.fileName,
  fileType: file.fileType,
  status: file.status,
  errorMessage: file.errorMessage,
  createdAt: file.createdAt,
});

const toAssetBrief = (asset: MockAssetRecord): AssetBrief => ({
  id: asset.id,
  name: asset.name,
  createdAt: asset.createdAt,
});

export const toAssetMeta = (asset: MockAssetRecord): AssetMeta => ({
  ...toAssetBrief(asset),
  updatedAt: asset.updatedAt ?? asset.createdAt,
});

const sortByUpdatedAtDesc = (
  conversations: MockConversationRecord[],
): MockConversationRecord[] =>
  [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const sortByCreatedAtDesc = <T extends { createdAt: string }>(
  records: T[],
): T[] => [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const toProjectNode = (
  project: Project,
  conversations: MockConversationRecord[],
  files: MockFileRecord[],
  assets: MockAssetRecord[],
): ProjectNode => {
  const sortedConversations = sortByUpdatedAtDesc(conversations);

  return {
    ...project,
    lastActiveConversationId: sortedConversations[0]?.id ?? null,
    files: sortByCreatedAtDesc(files.filter(({ upload }) => upload !== undefined))
      .slice(0, PROJECT_TREE_ITEM_LIMIT).map(toFileBrief),
    assets: sortByCreatedAtDesc(assets).slice(0, PROJECT_TREE_ITEM_LIMIT).map(toAssetBrief),
    conversations: sortedConversations.slice(0, PROJECT_TREE_ITEM_LIMIT).map(toConversationBrief),
  };
};

export const listProjectNodes = async (userId: string): Promise<ProjectNode[]> => {
  const database = await readMockDatabase(userId);

  return database.projects.map((project) =>
    toProjectNode(
      project,
      database.conversations.filter(
        (conversation) => conversation.projectId === project.id,
      ),
      database.files.filter((file) => file.projectId === project.id),
      database.assets.filter((asset) => asset.projectId === project.id),
    ),
  );
};

export const createProject = async (
  userId: string,
  input: CreateProjectInput,
  idempotencyKey: string,
): Promise<ProjectNode | null> =>
  updateMockDatabase(userId, (database) => {
    const now = Date.now();
    database.projectCreations = database.projectCreations.filter((entry) => entry.expiresAt > now);
    const replay = database.projectCreations.find((entry) => entry.key === idempotencyKey);
    if (replay) {
      return replay.input.name === input.name && replay.input.description === input.description
        ? replay.project
        : null;
    }

    const timestamp = new Date(now).toISOString();
    const projectId = randomUUID();
    const conversationId = randomUUID();
    const assetId = randomUUID();

    const project: Project = {
      id: projectId,
      name: input.name,
      description: input.description ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    /** 资产库骨架：挂一个示例资产，便于验证资产操作菜单。 */
    const asset: MockAssetRecord = {
      id: assetId,
      projectId,
      name: "初始架构",
      createdAt: timestamp,
      graphData: DEFAULT_ASSET_GRAPH,
    };

    /** 历史会话骨架：新项目下创建一条新会话。 */
    const conversation: MockConversationRecord = {
      id: conversationId,
      projectId,
      title: "新会话",
      draftGraph: null,
      draftVersion: 0,
      messageCount: 0,
      lastMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };

    database.projects.push(project);
    database.assets.push(asset);
    database.conversations.push(conversation);
    const result = toProjectNode(project, [conversation], [], [asset]);
    database.projectCreations.push({
      key: idempotencyKey,
      input,
      project: result,
      expiresAt: now + CREATE_KEY_TTL_MS,
    });
    return result;
  });

type CreateAssetResult =
  | { status: "created"; asset: AssetMeta; traceId: string }
  | { status: "project_not_found" }
  | { status: "key_reused" };

export const createAsset = (
  userId: string,
  projectId: string,
  input: AssetInput,
  idempotencyKey: string,
): Promise<CreateAssetResult> =>
  updateMockDatabase(userId, (database) => {
    if (!database.projects.some(({ id }) => id === projectId)) {
      return { status: "project_not_found" };
    }

    const now = Date.now();
    database.assetCreations = database.assetCreations.filter(({ expiresAt }) => expiresAt > now);
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const replay = database.assetCreations.find(
      (entry) => entry.projectId === projectId && entry.key === idempotencyKey,
    );
    if (replay) {
      return replay.hash === hash
        ? { status: "created", asset: replay.asset, traceId: replay.traceId }
        : { status: "key_reused" };
    }

    const timestamp = new Date(now).toISOString();
    const record: MockAssetRecord = {
      id: randomUUID(),
      projectId,
      name: input.name,
      createdAt: timestamp,
      updatedAt: timestamp,
      graphData: input.graph,
      layout: input.layout,
    };
    const asset = toAssetMeta(record);
    const traceId = randomUUID();
    database.assets.unshift(record);
    database.assetCreations.push({
      projectId,
      key: idempotencyKey,
      hash,
      asset,
      traceId,
      expiresAt: now + CREATE_KEY_TTL_MS,
    });
    return { status: "created", asset, traceId };
  });

export const getProjectAsset = async (
  userId: string,
  projectId: string,
  assetId: string,
): Promise<MockAssetRecord | null> => {
  const database = await readMockDatabase(userId);
  if (!database.projects.some(({ id }) => id === projectId)) return null;
  return database.assets.find((asset) => asset.id === assetId && asset.projectId === projectId) ?? null;
};

export type CreateConversationResult =
  | { status: "created"; conversation: Conversation }
  | { status: "project_not_found" }
  | { status: "asset_not_found" };

/** 在项目下新建空会话（画布初始为空）。 */
export const createConversation = async (
  userId: string,
  projectId: string,
  input: CreateConversationInput,
): Promise<CreateConversationResult> =>
  updateMockDatabase(userId, (database) => {
    const projectExists = database.projects.some(
      (project) => project.id === projectId,
    );

    if (!projectExists) {
      return { status: "project_not_found" };
    }

    /** §4.1：initialAssetId 必须属于当前项目，并用资产图初始化草稿。 */
    const initialAsset = input.initialAssetId
      ? database.assets.find(
          (asset) =>
            asset.id === input.initialAssetId && asset.projectId === projectId,
        )
      : undefined;

    if (input.initialAssetId && !initialAsset) {
      return { status: "asset_not_found" };
    }

    const timestamp = new Date().toISOString();
    const conversation: MockConversationRecord = {
      id: randomUUID(),
      projectId,
      title: input.title ?? "新会话",
      draftGraph: initialAsset?.graphData ?? null,
      draftLayout: initialAsset?.layout,
      draftVersion: 0,
      messageCount: 0,
      lastMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };

    database.conversations.push(conversation);

    return {
      status: "created",
      conversation: toMockConversation(conversation),
    };
  });

export const forkConversation = (
  userId: string,
  conversationId: string,
  { sourceMessageId }: ForkInput,
  idempotencyKey: string,
) =>
  updateMockDatabase(userId, (database) => {
    const source = getRunConversation(database, conversationId);
    if (!database.projects.some(({ id }) => id === source.projectId)) {
      throw new MockRunError(404, ERROR_CODES.CONVERSATION_NOT_FOUND, "会话不存在");
    }

    const now = Date.now();
    database.conversationForks = database.conversationForks.filter(
      ({ expiresAt }) => expiresAt > now,
    );
    const replay = database.conversationForks.find(
      ({ key, result }) =>
        key === idempotencyKey && result.forkedFrom.conversationId === conversationId,
    );
    if (replay) {
      if (replay.result.forkedFrom.sourceMessageId !== sourceMessageId) {
        throw new MockRunError(422, ERROR_CODES.IDEMPOTENCY_KEY_REUSED, "该请求键已用于其他分叉");
      }
      return { result: replay.result, traceId: replay.traceId };
    }

    const sourceIndex = source.messages.findIndex(({ id }) => id === sourceMessageId);
    if (sourceIndex === -1) {
      throw new MockRunError(404, ERROR_CODES.MESSAGE_NOT_FOUND, "消息不属于当前会话");
    }
    if (sourceIndex + 1 > FORK_MESSAGE_LIMIT) {
      throw new MockRunError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        `一次最多复制 ${FORK_MESSAGE_LIMIT} 条消息，请选择更早的消息。`,
      );
    }

    const messages = source.messages.slice(0, sourceIndex + 1).map((message): MockStoredMessage => {
      const id = randomUUID();
      const card = message.metadata?.card;
      if (!card) return { ...message, id };
      return {
        ...message,
        id,
        metadata: {
          ...message.metadata,
          card: {
            ...card,
            id: randomUUID(),
            messageId: id,
            status: card.status === "pending" ? "expired" : card.status,
          },
        },
      };
    });
    const timestamp = new Date(now).toISOString();
    const titleSuffix = "（分叉）";
    const titleLimit = CreateConversationInput.shape.title.unwrap().maxLength;
    const title = titleLimit === null
      ? source.title
      : source.title.slice(0, titleLimit - titleSuffix.length).toWellFormed();
    const record: MockConversationRecord = {
      id: randomUUID(),
      projectId: source.projectId,
      title: `${title}${titleSuffix}`,
      draftGraph: getHistoricalDraft(messages),
      draftVersion: 0,
      messageCount: 0,
      lastMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages,
    };
    updateConversationMessages(record, messages[sourceIndex]);

    const result = {
      ...toMockConversation(record),
      forkedFrom: { conversationId, sourceMessageId },
    };
    const traceId = randomUUID();
    database.conversations.push(record);
    database.conversationForks.push({
      key: idempotencyKey,
      result,
      traceId,
      expiresAt: now + CREATE_KEY_TTL_MS,
    });
    return { result, traceId };
  });

/** 删除项目：级联删除其知识库文件、资产与会话。 */
export const deleteProject = async (userId: string, projectId: string): Promise<boolean> => {
  const removedFileIds = await updateMockDatabase(userId, (database) => {
    const exists = database.projects.some(
      (project) => project.id === projectId,
    );

    if (!exists) {
      return null;
    }

    const fileIds = database.files.flatMap((file) => file.projectId === projectId && file.upload ? [file.id] : []);
    database.projects = database.projects.filter((project) => project.id !== projectId);
    database.files = database.files.filter((file) => file.projectId !== projectId);
    database.assets = database.assets.filter((asset) => asset.projectId !== projectId);
    database.assetCreations = database.assetCreations.filter((entry) => entry.projectId !== projectId);
    database.conversationForks = database.conversationForks.filter(
      ({ result }) => result.projectId !== projectId,
    );
    database.conversations = database.conversations.filter(
      (conversation) => conversation.projectId !== projectId,
    );

    return fileIds;
  });
  if (!removedFileIds) return false;
  for (const fileId of removedFileIds) await discardMockUpload(userId, fileId);
  return true;
};

export const deleteFile = async (
  userId: string,
  projectId: string,
  fileId: string,
): Promise<boolean> => {
  const removed = await updateMockDatabase(userId, (database) => {
    const index = database.files.findIndex(
      (file) => file.id === fileId && file.projectId === projectId,
    );
    return index < 0 ? undefined : database.files.splice(index, 1)[0];
  });
  if (removed?.upload) await discardMockUpload(userId, removed.id);
  return removed !== undefined;
};

export const deleteAsset = async (
  userId: string,
  projectId: string,
  assetId: string,
): Promise<boolean> =>
  updateMockDatabase(userId, (database) => {
    const exists = database.assets.some(
      (asset) => asset.id === assetId && asset.projectId === projectId,
    );

    if (!exists) {
      return false;
    }

    database.assets = database.assets.filter(
      (asset) => !(asset.id === assetId && asset.projectId === projectId),
    );

    return true;
  });

export const deleteConversation = async (
  userId: string,
  conversationId: string,
): Promise<boolean> =>
  updateMockDatabase(userId, (database) => {
    const exists = database.conversations.some(
      (conversation) => conversation.id === conversationId,
    );

    if (!exists) {
      return false;
    }

    database.conversations = database.conversations.filter(
      (conversation) => conversation.id !== conversationId,
    );
    database.conversationForks = database.conversationForks.filter(
      ({ result }) => result.forkedFrom.conversationId !== conversationId,
    );

    return true;
  });

/** 重命名会话；不改变 updatedAt，避免侧边栏排序因改名而跳动。 */
export const renameConversation = async (
  userId: string,
  conversationId: string,
  title: string,
): Promise<Conversation | null> =>
  updateMockDatabase(userId, (database) => {
    const conversation = database.conversations.find(
      (item) => item.id === conversationId,
    );

    if (!conversation) {
      return null;
    }

    conversation.title = title;
    conversation.titleManuallySet = true;
    return toMockConversation(conversation);
  });

/** 追加一条用户消息，并同步会话的计数、摘要与更新时间。 */
export const appendMessage = async (
  userId: string,
  conversationId: string,
  input: SendMessageInput,
): Promise<Message | null> =>
  updateMockDatabase(userId, (database) => {
    const conversation = database.conversations.find(
      (item) => item.id === conversationId,
    );

    if (!conversation) {
      return null;
    }

    const message = makeUserMessage(conversation, input.content);

    conversation.messages.push(message);
    conversation.messageCount += 1;
    conversation.lastMessage = {
      id: message.id,
      role: message.role,
      contentPreview: input.content.slice(0, 80),
      createdAt: message.createdAt,
    };
    conversation.updatedAt = message.createdAt;

    return Message.parse(message);
  });

export const getMockConversationRecord = async (
  userId: string,
  conversationId: string,
): Promise<MockConversationRecord | null> => {
  const database = await readMockDatabase(userId);
  return (
    database.conversations.find(
      (conversation) => conversation.id === conversationId,
    ) ?? null
  );
};

export const updateMockConversationRecord = async (
  userId: string,
  conversationId: string,
  update: (record: MockConversationRecord) => MockConversationRecord | null,
): Promise<MockConversationRecord | null> =>
  updateMockDatabase(userId, (database) => {
    const index = database.conversations.findIndex(
      (conversation) => conversation.id === conversationId,
    );
    const updated = index !== -1 && update(database.conversations[index]);
    if (!updated) return null;

    database.conversations[index] = updated;
    return updated;
  });

/** §4.2：只返回会话元信息 + 草稿图，不含消息。 */
export const getConversation = async (
  userId: string,
  conversationId: string,
): Promise<Conversation | null> => {
  const record = await getMockConversationRecord(userId, conversationId);
  return record ? toMockConversation(record) : null;
};

export const saveConversationDraft = (
  userId: string,
  conversationId: string,
  input: SaveDraftInput,
): Promise<SaveDraftResult> =>
  updateMockDatabase(userId, (database) => {
    const conversation = getRunConversation(database, conversationId);
    if (conversation.draftVersion !== input.baseVersion) {
      throw new MockRunError(
        409,
        ERROR_CODES.DRAFT_VERSION_CONFLICT,
        "画布已有更新，请读取已保存的草稿。",
      );
    }

    conversation.draftGraph = input.graph;
    conversation.draftLayout = input.layout;
    conversation.draftVersion += 1;
    conversation.updatedAt = new Date().toISOString();
    return {
      draftVersion: conversation.draftVersion,
      updatedAt: conversation.updatedAt,
    };
  });

/**
 * §4.4：消息游标分页。
 * cursor 使用消息 id（对前端不透明）；backward 从最新往前翻，forward 从游标往后翻。
 * 返回的 items 始终按时间正序排列，便于直接渲染。
 */
export const listMessages = async (
  userId: string,
  conversationId: string,
  query: MessageListQuery,
): Promise<Page<Message> | null> => {
  const database = await readMockDatabase(userId);
  const record = database.conversations.find(
    (conversation) => conversation.id === conversationId,
  );

  if (!record) {
    return null;
  }

  const messages = record.messages.filter(
    (message) => message.role !== "system",
  );
  const { limit, cursor, direction } = query;

  if (direction === "backward") {
    const cursorIndex = cursor
      ? messages.findIndex((message) => message.id === cursor)
      : messages.length;
    const endIndex = cursorIndex === -1 ? messages.length : cursorIndex;
    const startIndex = Math.max(0, endIndex - limit);
    const items = messages.slice(startIndex, endIndex).map((message) => Message.parse(message));
    const hasMore = startIndex > 0;

    return {
      items,
      nextCursor: hasMore && items.length > 0 ? items[0].id : null,
      hasMore,
    };
  }

  const cursorIndex = cursor
    ? messages.findIndex((message) => message.id === cursor)
    : -1;
  const startIndex = cursorIndex + 1;
  const items = messages.slice(startIndex, startIndex + limit).map((message) => Message.parse(message));
  const hasMore = startIndex + items.length < messages.length;

  return {
    items,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    hasMore,
  };
};
