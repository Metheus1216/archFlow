import { MockDatabase, type MockFileRecord } from "@arch-flow/shared";
import { describe, expect, it, vi } from "vitest";
import {
  createMockKnowledgeSearch,
  parseMockKnowledgeRequest,
} from "../lib/mock-knowledge-search";
import { MockUploadParseError } from "../lib/mock-upload-storage";

const ownerId = "test-owner";
const projectId = "test-project";
const otherProjectId = "other-project";
const timestamp = "2026-11-24T09:00:00.000Z";
const upload = { mimeType: "text/plain", sizeBytes: 115, digest: "a".repeat(64) };

const record = (fields: Partial<MockFileRecord>): MockFileRecord => ({
  id: "cache-md",
  projectId,
  fileName: "缓存规范.md",
  fileType: "text",
  status: "ready",
  createdAt: timestamp,
  upload,
  ...fields,
});

const setup = (files: MockFileRecord[], contents: Record<string, string> = {}) => {
  const database = MockDatabase.parse({
    projects: [projectId, otherProjectId].map((id) => ({
      id,
      name: id,
      description: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    conversations: [],
    files,
  });
  const readDatabase = vi.fn(async () => database);
  const readText = vi.fn(async (_userId: string, fileId: string) => contents[fileId] ?? "");
  const search = createMockKnowledgeSearch({ readDatabase, readText });
  const ask = (input: string, attachments: string[] = [], signal?: AbortSignal) => {
    const request = parseMockKnowledgeRequest(input, attachments);
    if (!request) throw new Error(`Expected a knowledge request: ${input}`);
    return search(ownerId, { projectId, attachments }, request, signal);
  };
  return { ask, readDatabase, readText };
};

describe("Mock knowledge request parsing", () => {
  it.each([
    ["根据《缓存规范》回答商品缓存 TTL", ["缓存规范"]],
    ["按项目的缓存规范给订单查询加缓存", ["缓存规范"]],
    ["说明 缓存规范.MD 中的商品缓存 TTL", ["缓存规范.MD"]],
    ["缓存规范里的商品缓存 TTL 是多久？", ["缓存规范"]],
    ["请问缓存规范.md 中的商品缓存 TTL？", ["缓存规范.md"]],
    ["请查一下缓存规范.md 中的缓存 TTL", ["缓存规范.md"]],
    ["请查看文档《缓存规范》的主要内容", ["缓存规范"]],
    ["依据附件中的《缓存规范》回答商品缓存 TTL", ["缓存规范"]],
    ["以《缓存规范》为依据，回答商品缓存 TTL", ["缓存规范"]],
    ["查看《Release Notes.txt》", ["Release Notes.txt"]],
    ["查询项目资料里的商品缓存 TTL", []],
  ])("recognizes an explicit source without rewriting the stored file name (%s)", (input, names) => {
    expect(parseMockKnowledgeRequest(input)).toMatchObject({ names });
  });

  it.each(["什么是知识库？", "生成知识库问答的架构图", "说明「订单服务」的职责", "有哪些缓存规范？", "生成 README.md 格式的架构图"])(
    "does not treat ordinary prompts as project knowledge requests (%s)",
    (input) => expect(parseMockKnowledgeRequest(input)).toBeNull(),
  );
});

describe("Mock knowledge search", () => {
  it("quotes exact Markdown and plain text only from the authorized project", async () => {
    const markdown = "## 商品缓存\r\n\r\n商品缓存 TTL 为 **371 秒**。";
    const text = "商品缓存 TTL：371 秒；订单停用清理另见手册。";
    const fixture = setup([
      record({}),
      record({ id: "cache-txt", fileName: "缓存参数.txt" }),
      record({ id: "other-md", projectId: otherProjectId }),
      record({ id: "legacy", fileName: "需求说明.md", upload: undefined }),
    ], { "cache-md": markdown, "cache-txt": text, "other-md": "商品缓存 TTL 为 999999 秒。" });

    const result = await fixture.ask("查询项目资料中的商品缓存 TTL");
    expect(fixture.readDatabase).toHaveBeenCalledWith(ownerId);
    expect(fixture.readText.mock.calls.map(([account, file]) => [account, file])).toEqual([
      [ownerId, "cache-md"], [ownerId, "cache-txt"],
    ]);
    expect(result.citations).toHaveLength(2);
    for (const citation of result.citations) {
      const source = citation.fileId === "cache-md" ? markdown : text;
      expect(source).toContain(citation.snippet);
      expect(citation.snippet).toContain("371 秒");
    }
  });

  it("uses the file boundary and attachment intersection rather than substituting a different match", async () => {
    const fixture = setup([
      record({ id: "other-md", projectId: otherProjectId, fileName: "缓存规范.md" }),
      record({ id: "another-md", fileName: "旧缓存规范.md" }),
      record({ id: "another-txt", fileName: "缓存参数.txt" }),
    ], { "another-md": "商品缓存 TTL 为 11 分钟。", "another-txt": "商品缓存 TTL 为 77 秒。" });

    await expect(fixture.ask("依据缓存规范.md 回答商品缓存 TTL")).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining("当前项目找不到"),
    });
    await expect(fixture.ask("依据《缓存规范》回答商品缓存 TTL")).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining("当前项目找不到"),
    });
    await expect(fixture.ask("依据《旧缓存规范》回答商品缓存 TTL", ["another-txt"])).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining("附件"),
    });
    expect(fixture.readText).not.toHaveBeenCalled();
  });

  it("retains all explicitly named requirements in later instruction clauses", async () => {
    const fixture = setup([record({})], { "cache-md": "商品缓存 TTL 为 371 秒。" });

    await expect(fixture.ask("回答商品缓存 TTL，根据《缓存规范》作答，参考《缺失规范》补充")).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining("当前项目找不到「缺失规范」"),
    });
    expect(fixture.readText).not.toHaveBeenCalled();
  });

  it("requires an unambiguous stem and accepts an exact NFKC/casefold filename", async () => {
    const fixture = setup([
      record({ id: "cache-md", fileName: "Cache.MD" }),
      record({ id: "cache-txt", fileName: "Cache.txt" }),
    ], { "cache-md": "Cache TTL: 371 seconds.", "cache-txt": "Cache TTL: 90 seconds." });
    await expect(fixture.ask("根据《Cache》回答 Cache TTL")).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining("完整文件名"),
    });
    await expect(fixture.ask("根据《ＣＡＣＨＥ．md》回答 Cache TTL")).resolves.toMatchObject({
      citations: [{ fileId: "cache-md", fileName: "Cache.MD" }],
    });
    expect(fixture.readText).toHaveBeenCalledOnce();
  });

  it("does not let a legacy stub shadow a real upload of the same name", async () => {
    const fixture = setup([
      record({ id: "legacy", upload: undefined }),
      record({}),
    ], { "cache-md": "商品缓存 TTL 为 371 秒。" });

    await expect(fixture.ask("说明缓存规范.md 中的商品缓存 TTL")).resolves.toMatchObject({
      citations: [{ fileId: "cache-md" }],
    });
    expect(fixture.readText).toHaveBeenCalledExactlyOnceWith(ownerId, "cache-md", undefined);
  });

  it("does not infer authorization from topic terms and searches only selected attachments", async () => {
    const fixture = setup([
      record({}),
      record({ id: "cache-txt", fileName: "缓存参数.txt" }),
    ], { "cache-md": "商品缓存 TTL 为 371 秒。", "cache-txt": "商品缓存 TTL 为 90 秒。" });

    await expect(fixture.ask("商品缓存 TTL 是多久？", ["cache-txt"])).resolves.toMatchObject({
      citations: [{ fileId: "cache-txt", snippet: "商品缓存 TTL 为 90 秒。" }],
    });
    expect(fixture.readText.mock.calls).toHaveLength(1);
    await expect(fixture.ask("查询项目资料，依据《缓存规范》回答商品缓存 TTL", ["cache-txt"])).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining("附件"),
    });
    await expect(fixture.ask("依据附件中的《缓存规范》回答商品缓存 TTL", ["cache-txt"])).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining("附件"),
    });
    expect(fixture.readText.mock.calls).toHaveLength(1);
  });

  it.each([
    ["processing.md", "text", "processing", "正在处理"],
    ["failed.txt", "text", "failed", "解析失败"],
    ["diagram.png", "image", "ready", "可引用"],
    ["policy.pdf", "pdf", "stored", "仅存储"],
    ["policy.docx", "docx", "stored", "仅存储"],
  ] as const)("does not open unavailable file bytes (%s)", async (fileName, fileType, status, reason) => {
    const fixture = setup([record({ fileName, fileType, status })]);

    await expect(fixture.ask(`依据《${fileName}》回答商品缓存 TTL`)).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining(reason),
    });
    expect(fixture.readText).not.toHaveBeenCalled();
  });

  it("requires question evidence, not a lone generic overlap or a filename hit", async () => {
    const fixture = setup([record({ fileName: "商品缓存-TTL.md" })], {
      "cache-md": "门店缓存头像，默认使用应用占位图。",
    });
    await expect(fixture.ask("查询项目资料中的商品缓存 TTL")).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining("相关原文"),
    });
    await expect(fixture.ask("基于《商品缓存-TTL.md》回答商品缓存 TTL")).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining("相关原文"),
    });
    await expect(fixture.ask("概括《商品缓存-TTL.md》的主要内容")).resolves.toMatchObject({
      citations: [{ fileId: "cache-md", snippet: "门店缓存头像，默认使用应用占位图。" }],
    });
    await expect(fixture.ask("依据《商品缓存-TTL.md》回答 X 是多少")).resolves.toMatchObject({
      citations: [],
    });
  });

  it("handles deletion during a read and honors abort without scanning other content", async () => {
    const fixture = setup([record({})]);
    fixture.readText.mockRejectedValueOnce(Object.assign(new Error("deleted"), { code: "ENOENT" }));
    await expect(fixture.ask("根据《缓存规范》回答商品缓存 TTL")).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining("原文"),
    });
    await expect(fixture.ask("根据《缓存规范》回答商品缓存 TTL", [], AbortSignal.abort())).rejects.toThrow();
    expect(fixture.readText).toHaveBeenCalledOnce();
  });

  it("reports a now-undecodable upload as unavailable without quoting it", async () => {
    const fixture = setup([record({})]);
    fixture.readText.mockRejectedValueOnce(new MockUploadParseError("undecodable"));

    await expect(fixture.ask("根据《缓存规范》回答商品缓存 TTL")).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining("原文"),
    });
  });

  it("yields while scanning a long document so a cancellation stops further reads", async () => {
    const fixture = setup([
      record({}),
      record({ id: "cache-txt", fileName: "缓存参数.txt" }),
    ], { "cache-md": "无关内容".repeat(100_000) });
    const controller = new AbortController();
    const result = fixture.ask("查询项目资料中的商品缓存 TTL", [], controller.signal);
    setImmediate(() => controller.abort());

    await expect(result).rejects.toThrow();
    expect(fixture.readText).toHaveBeenCalledExactlyOnceWith(ownerId, "cache-md", controller.signal);
  });

  it("does not misreport unrelated I/O errors as missing files", async () => {
    const fixture = setup([record({})]);
    const error = Object.assign(new Error("denied"), { code: "EACCES" });
    fixture.readText.mockRejectedValueOnce(error);
    await expect(fixture.ask("根据《缓存规范》回答商品缓存 TTL")).rejects.toBe(error);
  });

  it("does not quote a matching substitute when another explicitly named file lacks relevant text", async () => {
    const fixture = setup([
      record({}),
      record({ id: "cache-txt", fileName: "缓存参数.txt" }),
    ], { "cache-md": "商品缓存 TTL 为 371 秒。", "cache-txt": "当前落地流程另见手册。" });

    await expect(fixture.ask("对比《缓存规范》和《缓存参数》里的商品缓存 TTL", ["cache-md", "cache-txt"])).resolves.toMatchObject({
      citations: [], unavailableReason: expect.stringContaining("缓存参数.txt"),
    });
  });
});
