import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  ApiResponseSchema,
  AuthResult,
  ERROR_CODES,
  FILE_UPLOAD_MAX_BYTES,
  FileMeta,
  FileStatusResult,
  PROJECT_TREE_ITEM_LIMIT,
} from "@arch-flow/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as register } from "../app/api/mock/auth/[action]/route";
import { DELETE as deleteProject } from "../app/api/mock/projects/[projectId]/route";
import { DELETE as deleteFile } from "../app/api/mock/projects/[projectId]/files/[fileId]/route";
import { POST as uploadFile } from "../app/api/mock/projects/[projectId]/files/route";
import { GET as getStatus } from "../app/api/mock/projects/[projectId]/files/status/route";
import { createProject, listProjectNodes } from "../lib/mock-db";
import { readMockTextUpload } from "../lib/mock-upload-storage";

const ORIGIN = "http://localhost:3000";
const DIRECTORY_PREFIX = "archflow-mock-project-files-";
const PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgYGAAAAAEAAGjChXjAAAAAElFTkSuQmCC",
  "base64",
));

let directory: string;

const registerAccount = async (email: string) => {
  const response = await register(new Request(`${ORIGIN}/api/mock/auth/register`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ username: "AC7 files", email, password: "test-password" }),
  }), { params: Promise.resolve({ action: "register" }) });
  expect(response.status).toBe(201);
  const { data } = ApiResponseSchema(AuthResult).parse(await response.json());
  if (!data) throw new Error("注册未返回数据");
  return { userId: data.user.id, headers: { Authorization: `Bearer ${data.accessToken}` } };
};

const projectFor = async (userId: string, name: string) => {
  const project = await createProject(userId, { name }, randomUUID());
  if (!project) throw new Error("创建项目未返回数据");
  return project;
};

const setup = async () => {
  const owner = await registerAccount("owner@example.com");
  const project = await projectFor(owner.userId, "资料验收");
  const call = (projectId: string, headers: HeadersInit = owner.headers) => {
    const address = `${ORIGIN}/api/mock/projects/${projectId}/files`;
    const context = { params: Promise.resolve({ projectId }) };
    return {
      post: (body: BodyInit, requestHeaders?: HeadersInit) => {
        const merged = new Headers(headers);
        new Headers(requestHeaders).forEach((value, key) => merged.set(key, value));
        return uploadFile(new Request(address, { method: "POST", headers: merged, body }), context);
      },
      status: (ids: string[]) => getStatus(new Request(`${address}/status?ids=${ids.join(",")}`, { headers }), context),
      remove: (fileId: string) => deleteFile(new Request(`${address}/${fileId}`, { method: "DELETE", headers }), {
        params: Promise.resolve({ projectId, fileId }),
      }),
      removeProject: () => deleteProject(new Request(`${ORIGIN}/api/mock/projects/${projectId}`, {
        method: "DELETE", headers,
      }), context),
    };
  };
  return { ...owner, project, call, ...call(project.id) };
};

const multipart = (name: string, bytes: BlobPart, type?: string) => {
  const body = new FormData();
  body.append("file", new Blob([bytes], { type }), name);
  return body;
};

const fileData = async (response: Response, status = 201) => {
  expect(response.status).toBe(status);
  const { data } = ApiResponseSchema(FileMeta).parse(await response.json());
  if (!data) throw new Error("上传未返回文件状态");
  return data;
};

const statusData = async (response: Response) => {
  expect(response.status).toBe(200);
  return ApiResponseSchema(FileStatusResult).parse(await response.json()).data?.items;
};

const expectError = async (response: Response, status: number, code: string) => {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ code, data: null });
};

describe("local project file upload and processing", () => {
  beforeEach(async ({ onTestFinished }) => {
    const root = await realpath(tmpdir());
    const target = await mkdtemp(join(root, DIRECTORY_PREFIX));
    directory = target;
    vi.stubEnv("ARCHFLOW_MOCK_DIR", target);
    onTestFinished(async () => {
      vi.unstubAllEnvs();
      const resolved = await realpath(target);
      if (dirname(resolved) === root && basename(resolved).startsWith(DIRECTORY_PREFIX)) {
        await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
      }
    });
  });

  it("lists real Markdown and text from processing to ready without changing the original", async () => {
    const { project, userId, post, status } = await setup();
    expect(project.files).toEqual([]);
    const original = "# 缓存规范\r\n\r\n缓存上限为 47 秒。";
    const markdown = await fileData(await post(multipart("缓存规范.MD", original)));
    const text = await fileData(await post(multipart("限流.txt", "限流上限为 23 次。")));
    expect(markdown).toMatchObject({ fileType: "text", status: "processing", errorMessage: null });
    expect(text.status).toBe("processing");
    expect((await listProjectNodes(userId))[0].files).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: markdown.id, status: "processing" }),
      expect.objectContaining({ id: text.id, status: "processing" }),
    ]));
    expect(await statusData(await status([markdown.id, text.id]))).toEqual([
      { id: markdown.id, status: "ready", errorMessage: null },
      { id: text.id, status: "ready", errorMessage: null },
    ]);
    expect(await readMockTextUpload(userId, markdown.id)).toBe(original);
    expect((await listProjectNodes(userId))[0].files.every(({ status: state }) => state === "ready")).toBe(true);
  });

  it("decodes supported images, fails corrupt input and never parses PDF or DOCX", async () => {
    const { post, status } = await setup();
    const image = await fileData(await post(multipart("架构.png", PNG, "image/png")));
    const badImage = await fileData(await post(multipart("损坏.png", PNG.slice(0, 12), "image/png")));
    const wrongExtension = await fileData(await post(multipart("后缀不符.jpg", PNG, "image/jpeg")));
    const badText = await fileData(await post(multipart("损坏.txt", Uint8Array.of(0xff, 0xfe))));
    const blankText = await fileData(await post(multipart("空白.md", "\r\n\t ")));
    const pdf = await fileData(await post(multipart("审计.pdf", "%PDF-1.0\n")));
    const docx = await fileData(await post(multipart("纪要.docx", "stored without parsing")));
    expect([image.status, pdf.status, docx.status]).toEqual(["processing", "stored", "stored"]);
    expect(await statusData(await status([image.id, badImage.id, wrongExtension.id, badText.id, blankText.id, pdf.id, docx.id]))).toEqual([
      { id: image.id, status: "ready", errorMessage: null },
      { id: badImage.id, status: "failed", errorMessage: expect.stringContaining("图片") },
      { id: wrongExtension.id, status: "failed", errorMessage: expect.stringContaining("扩展名") },
      { id: badText.id, status: "failed", errorMessage: expect.stringContaining("UTF-8") },
      { id: blankText.id, status: "failed", errorMessage: expect.stringContaining("空") },
      { id: pdf.id, status: "stored", errorMessage: null },
      { id: docx.id, status: "stored", errorMessage: null },
    ]);
  });

  it("bounds multipart input even without a content length and rejects unsupported or missing files", async () => {
    const { post } = await setup();
    await expectError(await post(multipart("bad.exe", "a")), 415, ERROR_CODES.FILE_TYPE_UNSUPPORTED);
    await expectError(await post(new FormData()), 422, ERROR_CODES.VALIDATION_FAILED);
    await expectError(await post("broken", { "Content-Type": "multipart/form-data; boundary=broken" }), 400, ERROR_CODES.BAD_REQUEST);
    await expectError(await post(multipart("huge.txt", new Uint8Array(FILE_UPLOAD_MAX_BYTES + 1))), 413, ERROR_CODES.FILE_TOO_LARGE);
    await expectError(await post(multipart("stream.txt", new Uint8Array(FILE_UPLOAD_MAX_BYTES + 128 * 1024))), 413, ERROR_CODES.FILE_TOO_LARGE);
  });

  it("deduplicates concurrent exact retries and blocks replacing a same-name file implicitly", async () => {
    const { post, userId } = await setup();
    const responses = await Promise.all([
      post(multipart("限流.txt", "只存一份")),
      post(multipart("限流.txt", "只存一份")),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    const records = await Promise.all(responses.map((response) => fileData(response, response.status)));
    expect(records[0]).toEqual(records[1]);
    expect(await readdir(join(directory, "uploads", userId))).toHaveLength(1);
    await expectError(await post(multipart("限流.TXT", "不得覆盖")), 409, ERROR_CODES.FILE_NAME_CONFLICT);
  });

  it("keeps the project within the visible file limit without blocking retries and deletions", async () => {
    const { post, remove, userId } = await setup();
    const documents = await Promise.all(Array.from({ length: PROJECT_TREE_ITEM_LIMIT }, async (_, index) =>
      fileData(await post(multipart(`草案-${index}.txt`, "资料"))),
    ));
    await expectError(await post(multipart("超额资料.txt", "不会隐藏在侧栏之外")), 409, ERROR_CODES.FILE_LIMIT_EXCEEDED);
    await fileData(await post(multipart("草案-0.txt", "资料")), 200);
    expect((await listProjectNodes(userId))[0].files).toHaveLength(PROJECT_TREE_ITEM_LIMIT);
    expect((await remove(documents[0].id)).status).toBe(204);
    await fileData(await post(multipart("新资料.txt", "替换已删除的资料")));
  });

  it("requires ownership, filters status IDs by project, and removes original bytes on deletion", async () => {
    const { call, project, post, remove, removeProject, userId } = await setup();
    const outsider = await registerAccount("outsider@example.com");
    const other = await projectFor(userId, "另一个项目");
    const first = await fileData(await post(multipart("私有.txt", "不能跨项目读取")));
    const last = await fileData(await post(multipart("待删除.txt", "不保留文件字节")));
    await expectError(await call(project.id, outsider.headers).post(multipart("私有.txt", "越权上传")), 404, ERROR_CODES.PROJECT_NOT_FOUND);
    await expectError(await call(project.id, outsider.headers).status([first.id]), 404, ERROR_CODES.PROJECT_NOT_FOUND);
    expect(await statusData(await call(other.id).status([first.id]))).toEqual([]);
    await expectError(await call(other.id).remove(first.id), 404, ERROR_CODES.FILE_NOT_FOUND);
    expect((await remove(first.id)).status).toBe(204);
    await expect(readMockTextUpload(userId, first.id)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await removeProject()).status).toBe(204);
    await expect(readMockTextUpload(userId, last.id)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
