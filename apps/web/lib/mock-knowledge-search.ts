import "server-only";

import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { KNOWLEDGE_FILE_EXTENSION as FILE_END, parseKnowledgeRequest } from "@arch-flow/agent";
import type {
  AgentTurn,
  Citation,
  MockDatabase,
  MockFileRecord,
} from "@arch-flow/shared";
import { isMissingMockUpload, MockUploadParseError } from "./mock-upload-storage";

const MAX_SOURCES = 3;
const MAX_TERMS = 12;
const EXCERPT_LENGTH = 360;
const EXCERPT_STEP = 270;
const SCANS_PER_TICK = 256;
const QUESTION_FILLER = /(?:请问|帮我|告诉我|查找|查看|查询一下|检索|阅读|看看|看下|总结|概括|解读|解释|说明|回答|给个摘要|主要内容|大致内容|这个文件|这些文件|这份资料|这些资料|说了什么|讲了什么|有什么内容|有哪些|是什么|是多少|是多久|多长时间|多久|多少|什么|提到的|提到|规定的|关于|里面|可以吗|是否|的)|\b(?:what|which|how|a|an|the|are|is|it|of|in|for|to|does|do|about|say|according|please|show|tell|me|explain|describe|summari[sz]e|search)\b/giu;
const MARKDOWN_HEADING = /^\s*#{1,6}[^\S\r\n]+[^\r\n]+\s*$/u;

const fold = (text: string) => text.normalize("NFKC").toLowerCase();

export const parseMockKnowledgeRequest = parseKnowledgeRequest;

type KnowledgeRequest = NonNullable<ReturnType<typeof parseMockKnowledgeRequest>>;
type KnowledgeResult = { citations: Citation[]; unavailableReason?: string };

const noEvidence = (unavailableReason: string): KnowledgeResult => ({ citations: [], unavailableReason });

const unavailableFile = ({ fileName, fileType, status, upload }: MockFileRecord) => {
  const name = `「${fileName}」`;
  if (status === "processing") return `${name}正在处理，暂时没有可引用的原文。`;
  if (status === "failed") return `${name}解析失败，没有可引用的原文。`;
  if (status === "stored") return `${name}仅存储，没有可引用的解析结果。`;
  if (fileType !== "text" || !upload) return `${name}没有可引用的文本原文。`;
  return undefined;
};

const getQuestionTerms = (question: string) => [...new Set(
  question.match(/\p{Script=Han}{2,}|\p{Script=Latin}[\p{Script=Latin}\d_-]*|\d+(?:\.\d+)?/gu) ?? [],
)].slice(0, MAX_TERMS);

const getExcerpt = async (text: string, terms: string[], signal?: AbortSignal) => {
  const source = text.trim();
  if (!source) return undefined;
  if (!terms.length) return { snippet: source.slice(0, EXCERPT_LENGTH).trimEnd(), score: 1 };

  const required = terms.length <= 3 ? terms.length : Math.ceil((terms.length * 2) / 3);
  const matches = terms.map((term) => {
    if (/^\p{Script=Han}/u.test(term)) return (excerpt: string) => excerpt.includes(term);
    const word = new RegExp(`(?<![\\p{Script=Latin}\\d_])${term.replace(".", "\\.")}(?![\\p{Script=Latin}\\d_])`, "u");
    return (excerpt: string) => word.test(excerpt);
  });
  let best: { snippet: string; score: number } | undefined;
  let scanned = 0;
  const inspect = async (start: number, end: number) => {
    for (let offset = start; offset <= end; offset += EXCERPT_STEP) {
      if (++scanned % SCANS_PER_TICK === 0) await yieldToEventLoop(undefined, { signal });
      signal?.throwIfAborted();
      if (offset === end) break;
      const right = Math.min(offset + EXCERPT_LENGTH, end);
      const snippet = source.slice(offset, right).trim();
      const normalized = fold(snippet);
      const matched = matches.filter((match) => match(normalized)).length;
      if (matched >= required && (!best || matched / terms.length > best.score)) {
        best = { snippet, score: matched / terms.length };
      }
      if (best?.score === 1 || right === end) break;
    }
  };

  let start = 0;
  for (const boundary of source.matchAll(/\r?\n[^\S\r\n]*\r?\n/gu)) {
    if (boundary.index - start <= EXCERPT_LENGTH && MARKDOWN_HEADING.test(source.slice(start, boundary.index))) continue;
    await inspect(start, boundary.index);
    if (best?.score === 1) return best;
    start = boundary.index + boundary[0].length;
  }
  await inspect(start, source.length);
  return best;
};

export const createMockKnowledgeSearch = ({ readDatabase, readText }: {
  readDatabase: (userId: string) => Promise<MockDatabase>;
  readText: (userId: string, fileId: string, signal?: AbortSignal) => Promise<string>;
}) => async (
  userId: string,
  { projectId, attachments }: Pick<AgentTurn, "projectId" | "attachments">,
  request: KnowledgeRequest,
  signal?: AbortSignal,
): Promise<KnowledgeResult> => {
  signal?.throwIfAborted();
  const database = await readDatabase(userId);
  signal?.throwIfAborted();
  const projectFiles = database.files.filter((file) => file.projectId === projectId && file.upload);
  const selectedIds = new Set(attachments);
  const selected = (file: MockFileRecord) => !selectedIds.size || selectedIds.has(file.id);
  const names = new Map(request.names.map((name) => [fold(name), name]));
  if (names.size > MAX_SOURCES) return noEvidence(`请每次指定不超过 ${MAX_SOURCES} 份项目资料。`);

  const named = new Map<string, MockFileRecord>();
  for (const [key, name] of names) {
    const exact = projectFiles.filter(({ fileName }) => fold(fileName) === key);
    const matches = exact.length || FILE_END.test(key)
      ? exact
      : projectFiles.filter(({ fileName }) => fold(fileName).replace(FILE_END, "") === key);
    const scoped = matches.filter(selected);
    if (!matches.length) return noEvidence(`当前项目找不到「${name}」这份资料。`);
    if (!scoped.length) return noEvidence(`所选附件不包含「${name}」，请调整附件后重试。`);
    if (scoped.length !== 1) return noEvidence(`「${name}」对应多份资料，请指定完整文件名或只选择一份附件。`);
    const file = scoped[0];
    const unavailable = unavailableFile(file);
    if (unavailable) return noEvidence(unavailable);
    named.set(file.id, file);
  }

  const candidates = named.size ? [...named.values()] : projectFiles.filter(selected);
  const readable = candidates.filter((file) => !unavailableFile(file));
  if (!readable.length) {
    return noEvidence((candidates.length === 1 ? unavailableFile(candidates[0]) : undefined) ??
      (selectedIds.size ? "所选附件没有可引用的文本原文。" : "当前项目还没有可引用的文本原文，请上传 Markdown 或纯文本后重试。"));
  }

  const question = fold(request.instruction).replace(QUESTION_FILLER, " ");
  const terms = getQuestionTerms(question);
  if (!terms.length && !named.size && !selectedIds.size) {
    return noEvidence("请补充要查询的主题，或指定要查看的项目文件。");
  }
  if (!terms.length && /[\p{L}\p{N}]/u.test(question)) {
    return noEvidence("未识别到可检索的完整关键词，请补充要查询的主题。");
  }

  const citations: Citation[] = [];
  for (const file of readable) {
    signal?.throwIfAborted();
    let text: string;
    try {
      text = await readText(userId, file.id, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (!isMissingMockUpload(error) && !(error instanceof MockUploadParseError)) throw error;
      if (named.size || readable.length === 1) return noEvidence(`暂时无法读取「${file.fileName}」的原文。`);
      continue;
    }
    signal?.throwIfAborted();
    const excerpt = await getExcerpt(text, terms, signal);
    if (!excerpt) {
      if (named.size) return noEvidence(`「${file.fileName}」没有与问题匹配的相关原文，暂时无法依据这份资料回答。`);
      continue;
    }
    citations.push({ fileId: file.id, fileName: file.fileName, ...excerpt });
    citations.sort((left, right) => right.score - left.score);
    if (citations.length > MAX_SOURCES) citations.pop();
    if (citations.length === MAX_SOURCES && citations.at(-1)?.score === 1) break;
  }

  return citations.length ? { citations } : noEvidence("没有在指定范围内找到相关原文，暂时无法依据项目资料回答。");
};

export type MockKnowledgeSearch = ReturnType<typeof createMockKnowledgeSearch>;
