import "server-only";

import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { Id, MockAccountId } from "@arch-flow/shared";
import { getMockDir } from "./mock-files";

const getUploadPath = (userId: string, fileId: string) =>
  path.join(getMockDir(), "uploads", MockAccountId.parse(userId), `${Id.parse(fileId)}.bin`);

export class MockUploadParseError extends Error {}

export const isMissingMockUpload = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

export const readMockUpload = (userId: string, fileId: string, signal?: AbortSignal) =>
  readFile(getUploadPath(userId, fileId), { signal });

export const readMockTextUpload = async (userId: string, fileId: string, signal?: AbortSignal) => {
  const bytes = await readMockUpload(userId, fileId, signal);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new MockUploadParseError("无法读取文本编码，请将文件另存为 UTF-8 后重新上传。");
  }
  if (text.includes("\0")) throw new MockUploadParseError("文件不是可读文本，请重新上传 UTF-8 文本。");
  if (!text.trim()) throw new MockUploadParseError("文件没有可引用的内容，请上传非空文本。");
  return text;
};

export const discardMockUpload = async (userId: string, fileId: string) => {
  try {
    await unlink(getUploadPath(userId, fileId));
  } catch (error) {
    if (!isMissingMockUpload(error)) console.error("本地资料原文件清理失败", { fileId });
  }
};

export const writeMockUpload = async (userId: string, fileId: string, bytes: Buffer) => {
  const filePath = getUploadPath(userId, fileId);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const handle = await open(filePath, "wx", 0o600);
  try {
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  } catch (error) {
    await discardMockUpload(userId, fileId);
    throw error;
  }
};
