import { FILE_UPLOAD_EXTENSIONS } from "@arch-flow/shared";

const POLITE = /^(?:请问|请(?:帮我)?|帮我|please\b)\s*/iu;
const EMPHASIS = /^(?:(?:并且|同时|然后|再)\s*)?(?:注意|务必|记得|需要|必须)?\s*/u;
const SOURCE_ONLY = /^(?:仅|只|only\b)\s*/iu;
const DIRECTIVE = /^(?:按照|按|依据|基于|根据|参考|遵循|遵守|遵照|参照|依照|结合|使用|从|以(?=.+为(?:依据|准|参考))|according to\b|based on\b|from\b)\s*/iu;
const READER = /^(?:查找|查询|查看|查|检索|阅读|说明|解释|解读|介绍|概括|总结|回答|告诉我|看看|对比|比较|比对|explain\b|describe\b|summari[sz]e\b|search\b|show me\b)(?:一下)?\s*/iu;
const QUALIFIER = /^(?:(?:当前|本)?项目(?:中|里)?的|(?:我|刚才|已)?上传的)\s*/u;
const PROJECT_SOURCE = /^(?:(?:当前|本)?项目(?:中|里)?(?:的)?(?:资料|文档|文件|知识库|附件)|(?:我|刚才|已)?上传的(?:文件|文档|资料)|知识库|附件|(?:the )?(?:project (?:docs|documents|files|knowledge base)|attachments?)(?![a-z]))/iu;
const QUOTED_LABEL = /^(?:文档|文件|资料)\s*(?=[《「『“"])/u;
const LOCATION = /^\s*(?:里面|里|中|内)(?:的)?\s*/u;
const BARE_FILE_TAIL = /^\s*(?:里面|里|中|内|的|[，。！？；,:：.!?;]|$)/u;
const AFTER_SOURCE = /^\s*(?:(?:里面|里|中|内)的?|的(?:要求|规定)?|为(?:依据|准|参考)(?=$|[\s，,：:]))?\s*[,，:：]?\s*/u;
const NEXT_SOURCE = /^\s*(?:以及|并且|和|与|及|、|[,，]|and\b)\s*/iu;
const QUOTED_NAME = /^(?:《([^》\r\n]+)》|「([^」\r\n]+)」|『([^』\r\n]+)』|“([^”\r\n]+)”|"([^"\r\n]+)")/u;
const CLAUSE_BOUNDARY = new RegExp(`${QUOTED_NAME.source.slice(1)}|([。！？；\n,，!?;]\\s*)`, "gu");
const DOCUMENT_STEM = /^[^\s，。！？、；,:：.!?;《》「」『』“”"]*?(?:规范|标准|文档|资料|手册|指南|规则|说明|指引)(?=$|[\s，。！？、；,:：.!?;的中里内]|回答|解释|说明|告诉|先|给|为|在|修改|改图|调整|更新|添加|增加|生成|画|包含|写|提到|说|要求|规定|推荐|是|有哪些|如何)/u;
const DOCUMENT_SUFFIX = /(?:规范|标准|文档|资料|手册|指南|规则|说明|指引)$/u;
const EXTENSIONS = FILE_UPLOAD_EXTENSIONS.map((extension) => extension.slice(1)).join("|");
export const KNOWLEDGE_FILE_EXTENSION = new RegExp(`\\.(?:${EXTENSIONS})$`, "iu");
const UNQUOTED_FILE = new RegExp(
  `^[^\\p{Cc}<>《》「」『』“”"'，。！？、；,:：!?;|/\\\\]+?[.．](?:${EXTENSIONS})(?![a-z0-9_.-])`,
  "iu",
);

const fold = (text: string) => text.normalize("NFKC").toLowerCase();

const readName = (text: string, directed: boolean, reading: boolean) => {
  const quoted = QUOTED_NAME.exec(text);
  const quotedName = quoted?.slice(1).find(Boolean)?.trim();
  if (quoted && quotedName && (
    directed || KNOWLEDGE_FILE_EXTENSION.test(fold(quotedName)) || DOCUMENT_SUFFIX.test(quotedName) ||
    (text.startsWith("《") && (reading || LOCATION.test(text.slice(quoted[0].length))))
  )) return { name: quotedName, rest: text.slice(quoted[0].length) };

  const file = UNQUOTED_FILE.exec(text)?.[0];
  if (file) {
    const rest = text.slice(file.length);
    if (directed || reading || BARE_FILE_TAIL.test(rest)) return { name: file.trim(), rest };
  }

  const stem = DOCUMENT_STEM.exec(text)?.[0];
  if (stem && (directed || reading || LOCATION.test(text.slice(stem.length)))) {
    return { name: stem, rest: text.slice(stem.length) };
  }
  return undefined;
};

const readSource = (input: string, requireDirective = false) => {
  let text = input.trim().replace(POLITE, "").replace(EMPHASIS, "").replace(SOURCE_ONLY, "");
  const directive = DIRECTIVE.exec(text)?.[0];
  if (requireDirective && !directive) return undefined;
  text = text.slice(directive?.length ?? 0);
  const reader = READER.exec(text)?.[0];
  text = text.slice(reader?.length ?? 0);
  const generic = PROJECT_SOURCE.exec(text)?.[0];
  const qualified = text.replace(QUALIFIER, "").replace(QUOTED_LABEL, "");
  const specific = readName(qualified, !!directive, !!reader);
  const genericRest = generic ? text.slice(generic.length) : "";
  const scoped = genericRest.replace(AFTER_SOURCE, "").replace(QUOTED_LABEL, "").replace(/^(?:名叫|名为|名称为)\s*/u, "");
  const scopedName = generic && LOCATION.test(genericRest) && (QUOTED_NAME.test(scoped) || UNQUOTED_FILE.test(scoped))
    ? readName(scoped, true, false)
    : undefined;
  const specificName = specific && specific.name !== generic && PROJECT_SOURCE.exec(qualified)?.[0] !== specific.name
    ? specific : undefined;
  const first = scopedName ?? specificName;
  if (first) {
    const names = [first.name];
    let rest = first.rest;
    for (let separator = NEXT_SOURCE.exec(rest); separator; separator = NEXT_SOURCE.exec(rest)) {
      const next = readName(rest.slice(separator[0].length).replace(QUALIFIER, ""), true, false);
      if (!next) break;
      names.push(next.name);
      rest = next.rest;
    }
    return {
      names,
      instruction: rest.replace(/^\s*的?(?:文件|文档|资料)\s*[,，:：]\s*/u, "").replace(AFTER_SOURCE, "").trim(),
      directed: !!directive,
    };
  }
  if (!generic) return undefined;
  if (!directive && !reader && !LOCATION.test(genericRest)) return undefined;
  if (generic === "知识库" && /^\s*问答/u.test(genericRest)) return undefined;
  return { names: [], instruction: genericRest.replace(AFTER_SOURCE, "").trim(), directed: !!directive };
};

export const parseKnowledgeRequest = (input: string, attachments: string[] = []) => {
  const clauses: string[] = [];
  let start = 0;
  for (const separator of input.matchAll(CLAUSE_BOUNDARY)) {
    if (!separator.at(-1)) continue;
    const following = separator.index + separator[0].length;
    if (!readSource(input.slice(following), true)) continue;
    clauses.push(input.slice(start, separator.index));
    start = following;
  }
  clauses.push(input.slice(start));

  const sources = clauses.map((clause) => readSource(clause));
  if (!attachments.length && !sources.some(Boolean)) return null;
  return {
    names: sources.flatMap((source) => source?.names ?? []),
    instruction: clauses.map((clause, index) => sources[index]?.instruction ?? clause.trim()).filter(Boolean).join("，"),
    directed: sources.some((source) => source?.directed),
  };
};
