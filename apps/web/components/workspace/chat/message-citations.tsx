import type { Citation } from "@arch-flow/shared";

export const MessageCitations = ({ citations }: { citations: Citation[] }) => (
  <div className="mt-3 flex min-w-0 flex-col gap-2">
    <p className="text-xs font-medium text-muted-foreground">参考资料</p>
    <ul role="list" aria-label="参考资料" className="flex flex-col gap-2">
      {citations.map(({ fileId, fileName, snippet }, index) => (
        <li key={`${fileId}:${index}`} className="flex min-w-0 flex-col gap-1 border-l-2 border-border pl-2.5">
          <p className="whitespace-pre-wrap wrap-anywhere text-xs font-medium">{fileName}</p>
          <blockquote className="whitespace-pre-wrap wrap-anywhere text-xs leading-5 text-muted-foreground">{snippet}</blockquote>
        </li>
      ))}
    </ul>
  </div>
);
