"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PROJECT_TREE_ITEM_LIMIT,
  type Asset,
  type AssetInput,
  type AssetMeta,
  type Page,
  type ProjectNode,
} from "@arch-flow/shared";
import { toast } from "sonner";
import { apiPath, getAuthState, requestApi } from "@/lib/api-client";
import { projectQueryKey } from "@/lib/query-keys";
import { useAuth } from "./use-auth";

const ASSET_REQUEST_TIMEOUT_MS = 12_000;

export type ProjectAssetSubmission = {
  ownerId: string;
  projectId: string;
  idempotencyKey: string;
  input: AssetInput;
};

export const mergeProjectAsset = (
  page: Page<ProjectNode> | undefined,
  projectId: string,
  { id, name, createdAt }: AssetMeta,
): Page<ProjectNode> | undefined => {
  if (!page) return undefined;

  return {
    ...page,
    items: page.items.map((project) =>
      project.id === projectId
        ? {
            ...project,
            assets: [
              { id, name, createdAt },
              ...project.assets.filter((asset) => asset.id !== id),
            ]
              .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
              .slice(0, PROJECT_TREE_ITEM_LIMIT),
          }
        : project,
    ),
  };
};

export const useSaveProjectAsset = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ownerId,
      projectId,
      idempotencyKey,
      input,
    }: ProjectAssetSubmission) => {
      if (getAuthState().user?.id !== ownerId) {
        throw new DOMException("登录会话已切换", "AbortError");
      }

      return requestApi<AssetMeta>(apiPath(`/projects/${encodeURIComponent(projectId)}/assets`), {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(ASSET_REQUEST_TIMEOUT_MS),
      });
    },
    onSuccess: async (asset, { ownerId, projectId }) => {
      if (getAuthState().user?.id !== ownerId) return;

      const filters = { queryKey: projectQueryKey, exact: true };
      await queryClient.cancelQueries(filters);
      if (getAuthState().user?.id !== ownerId) return;

      queryClient.setQueryData<Page<ProjectNode>>(projectQueryKey, (page) =>
        mergeProjectAsset(page, projectId, asset),
      );
      void queryClient.invalidateQueries(filters);
      toast.success(`已保存资产“${asset.name}”`);
    },
  });
};

export const useProjectAsset = (projectId: string, assetId: string) => {
  const ownerId = useAuth().user?.id;

  return useQuery({
    queryKey: ["project-asset", ownerId, projectId, assetId],
    enabled: Boolean(ownerId),
    queryFn: async ({ signal }) => {
      if (!ownerId || getAuthState().user?.id !== ownerId) {
        throw new DOMException("登录会话已切换", "AbortError");
      }

      return requestApi<Asset>(apiPath(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`), {
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(ASSET_REQUEST_TIMEOUT_MS),
        ]),
      });
    },
  });
};
