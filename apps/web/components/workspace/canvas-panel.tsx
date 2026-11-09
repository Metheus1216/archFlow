"use client";

import { useState } from "react";
import {
  CircleHelp,
  LayoutGrid,
  Minus,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArchitectureCanvas } from "./architecture-canvas";
import { ConflictToast } from "./conflict-toast";
import { ExportMenu } from "./export-menu";
import type { WorkspaceVariant } from "./types";

const CanvasPanel = ({ variant }: { variant: WorkspaceVariant }) => {
  const isAsset = variant === "asset";
  const [zoom, setZoom] = useState(100);

  const decreaseZoom = () => {
    setZoom((value) => Math.max(50, value - 10));
  };

  const increaseZoom = () => {
    setZoom((value) => Math.min(150, value + 10));
  };

  return (
    <section className="relative flex min-h-0 min-w-0 flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="hidden min-w-0 items-center gap-1.5 text-xs md:flex">
            <span className="text-muted-foreground">当前画布：</span>
            <span className="truncate font-medium">
              {isAsset ? "V1 基础架构" : "方案 A"}
            </span>
          </div>
          <span className="hidden h-4 w-px bg-border md:block" />
          <Button variant="outline" size="sm">
            <LayoutGrid className="size-3.5" strokeWidth={1.75} />
            自动布局
          </Button>
          <ExportMenu defaultOpen={isAsset} />
        </div>

        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success" />
          已保存
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="canvas-grid absolute inset-0" />
        <div
          className="relative h-full w-full transition-transform duration-200"
          style={{ transform: `scale(${zoom / 100})` }}
        >
          <ArchitectureCanvas isEditing={isAsset} />
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4 pr-40">
          <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-[11px] text-muted-foreground">
            <Sparkles
              className="size-3.5 shrink-0 text-foreground"
              strokeWidth={1.75}
            />
            <span className="truncate">
              架构建议 · 基于当前约束，模块化单体比微服务更适合你的团队。
            </span>
          </div>
        </div>

        <div className="absolute bottom-3 right-3 z-20 flex items-center overflow-hidden rounded-md border border-border bg-card">
          <button
            type="button"
            aria-label="缩小画布"
            onClick={decreaseZoom}
            className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Minus className="size-3.5" strokeWidth={1.75} />
          </button>
          <span className="w-12 text-center text-[11px] tabular-nums text-muted-foreground">
            {zoom}%
          </span>
          <button
            type="button"
            aria-label="放大画布"
            onClick={increaseZoom}
            className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
          <span className="h-4 w-px bg-border" />
          <button
            type="button"
            aria-label="画布帮助"
            className="flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <CircleHelp className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>

        {isAsset && <ConflictToast />}
      </div>
    </section>
  );
};

export { CanvasPanel };
