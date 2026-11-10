import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MockDatabase,
  type AssetBrief,
  type ConversationBrief,
  type ConversationDetail,
  type CreateProjectInput,
  type FileBrief,
  type Message,
  type MockAssetRecord,
  type MockConversationRecord,
  type MockFileRecord,
  type Project,
  type ProjectNode,
  type SendMessageInput,
} from "@arch-flow/shared";

/**
 * 开发期 mock 数据源。
 *
 * Next 的 Route Handler 与 Server Component 可能落在不同的模块图里，
 * 因此不用进程内对象，而是落盘到 apps/web/.mock/db.json（已 gitignore）。
 */

const MOCK_DIR = path.join(process.cwd(), ".mock");
const MOCK_DB_PATH = path.join(MOCK_DIR, "db.json");

const emptyDatabase = (): MockDatabase => ({
  projects: [],
  files: [],
  assets: [],
  conversations: [],
});

const readDatabase = async (): Promise<MockDatabase> => {
  try {
    const raw = await readFile(MOCK_DB_PATH, "utf8");
    return MockDatabase.parse(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyDatabase();
    }
    throw error;
  }
};

const writeDatabase = async (database: MockDatabase): Promise<void> => {
  await mkdir(MOCK_DIR, { recursive: true });
  await writeFile(MOCK_DB_PATH, JSON.stringify(database, null, 2), "utf8");
};

const toConversationBrief = (
  conversation: MockConversationRecord,
): ConversationBrief => ({
  id: conversation.id,
  title: conversation.title,
  updatedAt: conversation.updatedAt,
});

const toFileBrief = (file: MockFileRecord): FileBrief => ({
  id: file.id,
  fileName: file.fileName,
  fileType: file.fileType,
  status: file.status,
  createdAt: file.createdAt,
});

const toAssetBrief = (asset: MockAssetRecord): AssetBrief => ({
  id: asset.id,
  name: asset.name,
  createdAt: asset.createdAt,
});

const sortByUpdatedAtDesc = (
  conversations: MockConversationRecord[],
): MockConversationRecord[] =>
  [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

const sortByCreatedAtDesc = <T extends { createdAt: string }>(
  records: T[],
): T[] =>
  [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
    files: sortByCreatedAtDesc(files).slice(0, 20).map(toFileBrief),
    assets: sortByCreatedAtDesc(assets).slice(0, 20).map(toAssetBrief),
    conversations: sortedConversations.slice(0, 20).map(toConversationBrief),
  };
};

export const listProjectNodes = async (): Promise<ProjectNode[]> => {
  const database = await readDatabase();

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

/** 登录后 / 首屏判断：有会话就直接进 workspace。 */
export const findFirstConversationId = async (): Promise<string | null> => {
  const database = await readDatabase();
  const [first] = sortByUpdatedAtDesc(database.conversations);

  return first?.id ?? null;
};

export const createProject = async (
  input: CreateProjectInput,
): Promise<ProjectNode> => {
  const database = await readDatabase();
  const timestamp = new Date().toISOString();
  const projectId = randomUUID();
  const conversationId = randomUUID();
  const fileId = randomUUID();
  const assetId = randomUUID();

  const project: Project = {
    id: projectId,
    name: input.name,
    description: input.description ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  /** 知识库骨架：挂一个可点击的示例文件，便于验证文件操作菜单。 */
  const file: MockFileRecord = {
    id: fileId,
    projectId,
    fileName: "需求说明.md",
    fileType: "text",
    status: "ready",
    createdAt: timestamp,
  };

  /** 资产库骨架：挂一个示例资产，便于验证资产操作菜单。 */
  const asset: MockAssetRecord = {
    id: assetId,
    projectId,
    name: "初始架构",
    createdAt: timestamp,
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

  await writeDatabase({
    projects: [...database.projects, project],
    files: [...database.files, file],
    assets: [...database.assets, asset],
    conversations: [...database.conversations, conversation],
  });

  return toProjectNode(project, [conversation], [file], [asset]);
};

/** 删除项目：级联删除其知识库文件、资产与会话。 */
export const deleteProject = async (projectId: string): Promise<boolean> => {
  const database = await readDatabase();
  const exists = database.projects.some((project) => project.id === projectId);

  if (!exists) {
    return false;
  }

  await writeDatabase({
    projects: database.projects.filter((project) => project.id !== projectId),
    files: database.files.filter((file) => file.projectId !== projectId),
    assets: database.assets.filter((asset) => asset.projectId !== projectId),
    conversations: database.conversations.filter(
      (conversation) => conversation.projectId !== projectId,
    ),
  });

  return true;
};

export const deleteFile = async (
  projectId: string,
  fileId: string,
): Promise<boolean> => {
  const database = await readDatabase();
  const exists = database.files.some(
    (file) => file.id === fileId && file.projectId === projectId,
  );

  if (!exists) {
    return false;
  }

  await writeDatabase({
    ...database,
    files: database.files.filter(
      (file) => !(file.id === fileId && file.projectId === projectId),
    ),
  });

  return true;
};

export const deleteAsset = async (
  projectId: string,
  assetId: string,
): Promise<boolean> => {
  const database = await readDatabase();
  const exists = database.assets.some(
    (asset) => asset.id === assetId && asset.projectId === projectId,
  );

  if (!exists) {
    return false;
  }

  await writeDatabase({
    ...database,
    assets: database.assets.filter(
      (asset) => !(asset.id === assetId && asset.projectId === projectId),
    ),
  });

  return true;
};

export const deleteConversation = async (
  conversationId: string,
): Promise<boolean> => {
  const database = await readDatabase();
  const exists = database.conversations.some(
    (conversation) => conversation.id === conversationId,
  );

  if (!exists) {
    return false;
  }

  await writeDatabase({
    ...database,
    conversations: database.conversations.filter(
      (conversation) => conversation.id !== conversationId,
    ),
  });

  return true;
};

/** 追加一条用户消息，并同步会话的计数、摘要与更新时间。 */
export const appendMessage = async (
  conversationId: string,
  input: SendMessageInput,
): Promise<Message | null> => {
  const database = await readDatabase();
  const conversation = database.conversations.find(
    (item) => item.id === conversationId,
  );

  if (!conversation) {
    return null;
  }

  const timestamp = new Date().toISOString();
  const message: Message = {
    id: randomUUID(),
    role: "user",
    content: input.content,
    graphSnapshot: null,
    metadata: null,
    createdAt: timestamp,
  };

  await writeDatabase({
    ...database,
    conversations: database.conversations.map((item) =>
      item.id === conversationId
        ? {
            ...item,
            messages: [...item.messages, message],
            messageCount: item.messageCount + 1,
            lastMessage: {
              id: message.id,
              role: message.role,
              contentPreview: input.content.slice(0, 80),
              createdAt: timestamp,
            },
            updatedAt: timestamp,
          }
        : item,
    ),
  });

  return message;
};

export const getConversationDetail = async (
  conversationId: string,
): Promise<ConversationDetail | null> => {
  const database = await readDatabase();
  const record = database.conversations.find(
    (conversation) => conversation.id === conversationId,
  );

  if (!record) {
    return null;
  }

  const { messages, ...conversation } = record;

  return { conversation, messages };
};
