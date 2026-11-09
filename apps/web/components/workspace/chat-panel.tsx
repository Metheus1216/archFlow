"use client";

import { useState } from "react";
import { Loader2, MoreHorizontal, Send } from "lucide-react";
import { BrandMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TEAM_OPTIONS = ["1–3 人", "4–10 人", "10 人以上"] as const;

type TeamOption = (typeof TEAM_OPTIONS)[number];

const ChatPanel = () => {
  const [teamSize, setTeamSize] = useState<TeamOption>("1–3 人");

  return (
    <section className="flex min-h-0 min-w-0 flex-col border-r border-border bg-background">
      <header className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            架构会话
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="更多操作">
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </Button>
        </div>

        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          讨论团队规模
        </h1>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
            3 人团队
          </span>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
            云部署
          </span>
        </div>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <p className="text-center text-[11px] text-muted-foreground">
          今天 14:32
        </p>

        <div className="mt-5 flex justify-end">
          <div className="max-w-[88%] rounded-xl rounded-tr-sm bg-secondary px-4 py-3 text-[13px] leading-6 text-secondary-foreground">
            我想做一个面向中小团队的实时数据分析 SaaS，用户可以接入数据库并创建仪表盘。
          </div>
        </div>

        <div className="mt-6 flex items-start gap-3">
          <BrandMark className="mt-0.5 size-6 shrink-0" />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-[13px] leading-6">
              明白了。我会帮你设计一套兼顾开发效率和后续扩展的架构。
            </p>

            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
              正在检索架构知识库…
            </div>

            <div className="rounded-lg border border-border bg-card/60 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] tracking-[0.16em] text-muted-foreground">
                  01 / 03
                </span>
                <span className="text-[10px] text-muted-foreground">
                  约束收集
                </span>
              </div>

              <h2 className="mt-2 text-sm font-semibold">你的团队规模是？</h2>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                团队规模会直接影响服务拆分粒度和运维复杂度。
              </p>

              <div
                role="radiogroup"
                aria-label="团队规模"
                className="mt-3 space-y-2"
              >
                {TEAM_OPTIONS.map((option) => {
                  const selected = teamSize === option;

                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setTeamSize(option)}
                      className={cn(
                        "flex h-9 w-full items-center gap-3 rounded-md border px-3 text-left text-xs transition-colors",
                        selected
                          ? "border-foreground/70 bg-secondary/60 text-foreground"
                          : "border-border text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                          selected
                            ? "border-foreground"
                            : "border-muted-foreground/50",
                        )}
                      >
                        {selected && (
                          <span className="size-1.5 rounded-full bg-foreground" />
                        )}
                      </span>
                      {option}
                    </button>
                  );
                })}

                <div className="flex h-9 items-center gap-3 rounded-md border border-border px-3">
                  <span className="size-3.5 shrink-0 rounded-full border border-muted-foreground/50" />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    其他
                  </span>
                  <input
                    type="text"
                    aria-label="其他团队规模"
                    placeholder="输入团队规模"
                    className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-4">
        <div className="rounded-xl border border-border bg-card p-3">
          <textarea
            rows={2}
            placeholder="描述你的技术约束或回答问题..."
            className="w-full resize-none bg-transparent text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              ↵ Enter 发送
            </span>
            <button
              type="button"
              aria-label="发送消息"
              className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Send className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
        <p className="mt-3 text-center text-[10px] text-muted-foreground">
          ArchFlow 可能会犯错，请在生产使用前审查关键决策。
        </p>
      </div>
    </section>
  );
};

export { ChatPanel };
