"use client";

import dynamic from "next/dynamic";
import type { AssetBrief } from "@arch-flow/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useProjectAsset } from "@/hooks/use-project-asset";
import { ApiError } from "@/lib/api-client";

const AssetLoading = () => (
  <p className="p-4 text-xs text-muted-foreground" role="status">
    正在加载资产…
  </p>
);

const GraphCanvas = dynamic(
  async () => (await import("../canvas/graph-canvas")).GraphCanvas,
  { ssr: false, loading: AssetLoading },
);

const AssetPreview = ({
  projectId,
  assetId,
}: {
  projectId: string;
  assetId: string;
}) => {
  const asset = useProjectAsset(projectId, assetId);

  if (asset.isPending) return <AssetLoading />;

  if (asset.isError) {
    const message =
      asset.error instanceof ApiError ? asset.error.message : "暂时无法加载资产。";

    return (
      <div className="flex flex-wrap items-center gap-2 p-4">
        <p role="alert" className="text-xs text-muted-foreground">
          {message}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={asset.isFetching}
          onClick={() => void asset.refetch()}
        >
          重试
        </Button>
      </div>
    );
  }

  if (asset.data.graph.nodes.length === 0) {
    return (
      <p className="p-4 text-xs text-muted-foreground" role="status">
        这项资产还没有架构节点。
      </p>
    );
  }

  return <GraphCanvas graph={asset.data.graph} positions={asset.data.layout} />;
};

export const AssetPreviewDialog = ({
  projectId,
  asset,
}: {
  projectId: string;
  asset: AssetBrief;
}) => (
  <Dialog>
    <DialogTrigger asChild>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center self-stretch rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="truncate">{asset.name}</span>
      </button>
    </DialogTrigger>
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle className="break-all pr-7">{asset.name}</DialogTitle>
        <DialogDescription>只读预览</DialogDescription>
      </DialogHeader>
      <div className="relative h-[50dvh] min-h-48 overflow-hidden rounded-md border border-border">
        <AssetPreview projectId={projectId} assetId={asset.id} />
      </div>
    </DialogContent>
  </Dialog>
);
