"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FILE_UPLOAD_EXTENSIONS,
  FILE_UPLOAD_MAX_BYTES,
  FileMeta,
  FileStatusResult,
  FileUploadName,
  FileUploadSize,
  type FileBrief,
  type FileStatusBrief,
  type Page,
  type ProjectNode,
} from "@arch-flow/shared";
import { toast } from "sonner";
import { ApiError, apiPath, getAuthState, requestApi } from "@/lib/api-client";
import { projectQueryKey } from "@/lib/query-keys";
import { useAuth } from "./use-auth";

const UPLOAD_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 12_000;
const STATUS_START_MS = 2_000;
const STATUS_MAX_INTERVAL_MS = 60_000;
const PROJECT_FILTERS = { queryKey: projectQueryKey, exact: true } as const;
export const FILE_UPLOAD_LIMIT_MIB = FILE_UPLOAD_MAX_BYTES / 1024 ** 2;

type ProjectUpload = {
  ownerId: string;
  projectId: string;
  file: File;
  signal: AbortSignal;
};

const isCurrentOwner = (ownerId: string) => getAuthState().user?.id === ownerId;

const ensureCurrentOwner = (ownerId: string | undefined) => {
  if (!ownerId || !isCurrentOwner(ownerId)) {
    throw new DOMException("登录会话已切换", "AbortError");
  }
};

export const getUploadFileError = ({ name, size }: Pick<File, "name" | "size">): string | null => {
  const parsedName = FileUploadName.safeParse(name);
  if (!parsedName.success) return "文件名无效，请缩短名称并移除路径字符。";
  const extensionStart = parsedName.data.lastIndexOf(".");
  const extension = extensionStart < 0 ? "" : parsedName.data.slice(extensionStart).toLowerCase();
  if (!FILE_UPLOAD_EXTENSIONS.includes(extension)) return "不支持此文件类型，请选择支持的格式。";
  if (size === 0) return "文件为空，请选择有内容的文件。";
  if (!FileUploadSize.safeParse(size).success) return `文件超过 ${FILE_UPLOAD_LIMIT_MIB} MB，请缩小文件后重试。`;
  return null;
};

export const mergeProjectFileStatuses = (
  page: Page<ProjectNode> | undefined,
  projectId: string,
  ids: readonly string[],
  updates: FileStatusBrief[],
): Page<ProjectNode> | undefined => {
  if (!page) return undefined;
  const requested = new Set(ids);
  const byId = new Map(updates.map((item) => [item.id, item]));

  return {
    ...page,
    items: page.items.map((project) => {
      if (project.id !== projectId) return project;
      return {
        ...project,
        files: project.files.flatMap((file) => {
          if (file.status !== "processing" || !requested.has(file.id)) return [file];
          const update = byId.get(file.id);
          return update ? [{ ...file, ...update }] : [];
        }),
      };
    }),
  };
};

const delayFirstStatusCheck = (signal: AbortSignal) => new Promise<void>((resolve) => {
  if (signal.aborted) {
    resolve();
    return;
  }
  const finish = () => {
    clearTimeout(timer);
    signal.removeEventListener("abort", finish);
    resolve();
  };
  const timer = setTimeout(finish, STATUS_START_MS);
  signal.addEventListener("abort", finish, { once: true });
});

export const useUploadProjectFile = () => {
  const queryClient = useQueryClient();

  return useMutation({
    networkMode: "always",
    mutationFn: async ({ ownerId, projectId, file, signal }: ProjectUpload) => {
      ensureCurrentOwner(ownerId);
      const body = new FormData();
      body.set("file", file);
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(UPLOAD_TIMEOUT_MS)]);
      requestSignal.throwIfAborted();
      const result = FileMeta.parse(await requestApi(apiPath(`/projects/${encodeURIComponent(projectId)}/files`), {
        method: "POST",
        body,
        signal: requestSignal,
      }));
      requestSignal.throwIfAborted();
      ensureCurrentOwner(ownerId);
      return result;
    },
    onSuccess: (file, { ownerId, signal }) => {
      if (!isCurrentOwner(ownerId)) return;
      void queryClient.invalidateQueries(PROJECT_FILTERS);
      if (!signal.aborted) toast.success(`已上传“${file.fileName}”`);
    },
    onError: (error, { ownerId, signal }) => {
      if ((signal.aborted || !(error instanceof ApiError)) && isCurrentOwner(ownerId)) {
        void queryClient.invalidateQueries(PROJECT_FILTERS);
      }
    },
  });
};

export const useProjectFileStatuses = (projectId: string, files: FileBrief[]) => {
  const ownerId = useAuth().user?.id;
  const queryClient = useQueryClient();
  const ids = files.filter(({ status }) => status === "processing").map(({ id }) => id).sort();
  const queryKey = ["project-file-status", ownerId, projectId, ids] as const;

  return useQuery({
    queryKey,
    enabled: Boolean(ownerId && ids.length),
    retry: false,
    staleTime: 0,
    gcTime: STATUS_MAX_INTERVAL_MS,
    queryFn: async ({ signal }) => {
      ensureCurrentOwner(ownerId);
      const state = queryClient.getQueryState(queryKey);
      if (!state?.dataUpdatedAt && !state?.errorUpdatedAt) await delayFirstStatusCheck(signal);
      signal.throwIfAborted();
      ensureCurrentOwner(ownerId);

      const query = new URLSearchParams({ ids: ids.join(",") });
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(STATUS_TIMEOUT_MS)]);
      const result = FileStatusResult.parse(await requestApi(
        apiPath(`/projects/${encodeURIComponent(projectId)}/files/status?${query}`),
        { signal: requestSignal },
      ));
      requestSignal.throwIfAborted();
      ensureCurrentOwner(ownerId);
      if (result.items.length !== ids.length || result.items.some(({ status }) => status !== "processing")) {
        const refreshInterrupted = queryClient.getQueryState(projectQueryKey)?.fetchStatus === "fetching";
        try {
          if (refreshInterrupted) await queryClient.cancelQueries(PROJECT_FILTERS);
          requestSignal.throwIfAborted();
          ensureCurrentOwner(ownerId);
          queryClient.setQueryData<Page<ProjectNode>>(projectQueryKey, (page) =>
            mergeProjectFileStatuses(page, projectId, ids, result.items),
          );
        } finally {
          if (refreshInterrupted && ownerId && isCurrentOwner(ownerId)) {
            void queryClient.invalidateQueries(PROJECT_FILTERS);
          }
        }
      }
      return result;
    },
    refetchInterval: ({ state }) => {
      if (state.data && !state.data.items.some(({ status }) => status === "processing")) return false;
      const exponent = Math.max(0, state.dataUpdateCount + state.errorUpdateCount - 1);
      return Math.min(STATUS_MAX_INTERVAL_MS, STATUS_START_MS * 2 ** exponent);
    },
  });
};
