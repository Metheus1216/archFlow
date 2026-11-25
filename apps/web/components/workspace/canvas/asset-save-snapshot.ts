import { AssetInput, type Conversation } from "@arch-flow/shared";
import type { ProjectAssetSubmission } from "@/hooks/use-project-asset";
import { layoutDraftGraph } from "./canvas-layout";

type AssetSnapshotInput = Pick<Conversation, "projectId" | "title"> &
  Pick<AssetInput, "graph" | "layout"> & { ownerId: string };

export const captureAssetSave = ({
  ownerId,
  projectId,
  title,
  graph,
  layout,
}: AssetSnapshotInput) => {
  const snapshot = structuredClone({
    graph,
    layout: layoutDraftGraph(graph, layout),
  });
  const keysByName = new Map<string, string>();

  return {
    initialName: title.trim(),
    prepare: (name: string): ProjectAssetSubmission | null => {
      const input = AssetInput.safeParse({ ...snapshot, name });
      if (!input.success) return null;

      const idempotencyKey =
        keysByName.get(input.data.name) ?? crypto.randomUUID();
      keysByName.set(input.data.name, idempotencyKey);
      return { ownerId, projectId, idempotencyKey, input: input.data };
    },
  };
};

export type AssetSaveSnapshot = ReturnType<typeof captureAssetSave>;
