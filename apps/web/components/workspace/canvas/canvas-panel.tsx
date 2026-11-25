"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, Loader2, Minus, Plus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useCanvasDraftEdit, type useCanvasDraft } from "@/hooks/use-canvas-draft";
import { useConversation } from "@/hooks/use-conversation";
import { getAuthState } from "@/lib/api-client";
import { parseMockGraph } from "@/lib/mock-graph";
import { readMockGraph } from "@/lib/read-mock-graph";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store";
import { ArchitectureCanvas } from "./architecture-canvas";
import { captureAssetSave } from "./asset-save-snapshot";
import { layoutDraftGraph } from "./canvas-layout";
import { ExportMenu } from "./export-menu";
import { GraphCanvas } from "./graph-canvas";

const CanvasStatus = ({
  label,
  busy,
  saved,
}: {
  label: string;
  busy: boolean;
  saved: boolean;
}) => (
  <div
    role="status"
    className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"
  >
    {busy ? (
      <Loader2
        className="size-3 animate-spin"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    ) : (
      <span
        className={cn(
          "size-1.5 rounded-full",
          saved ? "bg-success" : "bg-border",
        )}
      />
    )}
    {label}
  </div>
);

export const CanvasPanel = ({
  conversationId,
  draftActions,
}: {
  conversationId: string | null;
  draftActions: ReturnType<typeof useCanvasDraft>;
}) => {
  const ownerId = useAuth().user?.id;
  const conversation = useConversation(conversationId);
  const edit = useCanvasDraftEdit(conversationId);
  const {
    startMove,
    finishMove,
    changeLayout,
    save,
    reloadLatest,
    restoredVersion,
    restoring,
  } = draftActions;
  const [layoutRevision, setLayoutRevision] = useState(0);
  const draftGraph = conversation.data?.draftGraph ?? null;
  const savedGraph = useMemo(() => readMockGraph(draftGraph), [draftGraph]);
  const graph = edit?.graph ?? savedGraph;
  const topology = useMemo(
    () =>
      graph &&
      [
        graph.nodes.map(({ id }) => id).join(","),
        graph.edges
          .map(({ source, target }) => `${source}>${target}`)
          .join(","),
      ].join("/"),
    [graph],
  );
  const layout = edit ? edit.layout : conversation.data?.draftLayout;
  const basis =
    graph && conversation.data
      ? {
          graph,
          layout,
          baseVersion: edit?.baseVersion ?? conversation.data.draftVersion,
        }
      : null;
  const hasGraph = Boolean((graph ?? draftGraph)?.nodes.length);
  const legacy = !graph && hasGraph ? parseMockGraph(draftGraph) : null;
  const canEdit =
    basis && !restoring && (!edit?.failure?.conflict || edit.moving) ? basis : null;
  const assetSource =
    ownerId && conversation.data && graph?.nodes.length && !edit?.moving
      ? {
          ownerId,
          projectId: conversation.data.projectId,
          title: conversation.data.title,
          graph,
          layout,
        }
      : null;
  const busy = Boolean(
    restoring ||
    edit?.writing ||
    edit?.reloading ||
    (conversationId && conversation.isPending),
  );

  let status = hasGraph ? "已保存" : "暂无草稿";
  if (!conversationId) status = "未选择会话";
  else if (conversation.isPending) status = "加载中";
  else if (restoring) status = "正在恢复画布";
  else if (edit?.reloading) status = "正在读取最新画布";
  else if (edit?.failure)
    status = edit.failure.conflict ? "草稿版本冲突" : "保存失败";
  else if (edit?.writing) status = "保存中";
  else if (edit?.saveAfter || edit?.moving) status = "待保存";
  else if (conversation.isLoadingError) status = "加载失败";

  const autoLayout = () => {
    if (!canEdit) return;
    changeLayout(canEdit, layoutDraftGraph(canEdit.graph));
    setLayoutRevision((revision) => revision + 1);
  };

  const showLatest = async () => {
    if (await reloadLatest()) setLayoutRevision((revision) => revision + 1);
  };

  const captureCurrentAsset = () =>
    assetSource && getAuthState().user?.id === assetSource.ownerId
      ? captureAssetSave(assetSource)
      : null;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="hidden min-w-0 items-center gap-1.5 text-xs md:flex">
            <span className="shrink-0 text-muted-foreground">当前画布</span>
            <span className="truncate font-medium">
              {conversation.data?.title ?? "未命名画布"}
            </span>
          </div>
          <span className="hidden h-4 w-px bg-border md:block" />
          <Button
            variant="outline"
            size="sm"
            disabled={!canEdit || !hasGraph || edit?.moving}
            onClick={autoLayout}
          >
            <LayoutGrid className="size-3.5" strokeWidth={1.75} />
            自动布局
          </Button>
          <ExportMenu captureAsset={assetSource ? captureCurrentAsset : undefined} />
        </div>
        <CanvasStatus label={status} busy={busy} saved={status === "已保存"} />
      </div>

      {edit?.failure && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted px-4 py-2 text-xs">
          <div>
            <p>{edit.failure.message}</p>
            {edit.failure.conflict && assetSource && (
              <p>可先通过「导出 → 保存为项目资产」保留本页调整。</p>
            )}
          </div>
          {edit.failure.conflict ? (
            <Button
              variant="outline"
              size="sm"
              disabled={restoring || edit.reloading || edit.moving}
              onClick={() => void showLatest()}
            >
              读取最新画布
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={restoring || edit.moving}
              onClick={() => void save()}
            >
              重试保存
            </Button>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="canvas-grid absolute inset-0" />

        {hasGraph && graph && (
          <GraphCanvas
            key={`${layoutRevision}:${restoredVersion ?? ""}:${topology}`}
            graph={graph}
            positions={layout}
            onPositionEditStart={canEdit ? () => startMove(canEdit) : undefined}
            onPositionsChange={
              canEdit
                ? (positions) => changeLayout(canEdit, positions)
                : undefined
            }
            onPositionEditEnd={finishMove}
          />
        )}

        {legacy && <LegacyDraftCanvas graph={legacy} />}

        {hasGraph && !graph && !legacy && (
          <p
            role="status"
            className="relative p-4 text-xs text-muted-foreground"
          >
            无法显示这张架构图。
          </p>
        )}

        {!hasGraph && !busy && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8">
            <div className="max-w-[280px] text-center">
              <div className="mx-auto flex size-9 items-center justify-center rounded-md border border-border bg-card">
                <Workflow
                  className="size-4 text-muted-foreground"
                  strokeWidth={1.75}
                />
              </div>
              <p className="mt-3 text-sm font-medium">
                {conversation.isLoadingError && conversationId
                  ? "暂时无法加载画布"
                  : conversationId
                    ? "画布还是空的"
                    : "还没有选择会话"}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {conversation.isLoadingError && conversationId
                  ? "重新打开会话后再试。"
                  : conversationId
                    ? "在左侧对话中确认约束并生成方案后，架构节点会显示在这里。"
                    : "从左侧项目树选择一个会话，或新建项目开始。"}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

const LegacyDraftCanvas = ({
  graph,
}: Parameters<typeof ArchitectureCanvas>[0]) => {
  const zoom = useWorkspaceStore((state) => state.zoom);
  const decreaseZoom = useWorkspaceStore((state) => state.decreaseZoom);
  const increaseZoom = useWorkspaceStore((state) => state.increaseZoom);
  return (
    <>
      <div
        className="relative h-full w-full transition-transform duration-200"
        style={{ transform: `scale(${zoom / 100})` }}
      >
        <ArchitectureCanvas graph={graph} />
      </div>
      <div className="absolute right-3 bottom-3 z-20 flex items-center overflow-hidden rounded-md border border-border bg-card">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="缩小画布"
          onClick={decreaseZoom}
        >
          <Minus className="size-3.5" />
        </Button>
        <span className="w-12 text-center text-[11px] tabular-nums text-muted-foreground">
          {zoom}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="放大画布"
          onClick={increaseZoom}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
    </>
  );
};
