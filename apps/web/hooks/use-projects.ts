"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Conversation,
  CreateProjectInput,
  Page,
  Project,
  ProjectNode,
} from "@arch-flow/shared";
import {
  ApiError,
  FORMAL_API_ENABLED,
  apiPath,
  getAuthState,
  requestApi,
} from "@/lib/api-client";
import { projectQueryKey } from "@/lib/query-keys";
import { useAuth } from "./use-auth";

export const DEFAULT_PROJECT_NAME = "新架构项目";
const PROJECT_CREATE_TIMEOUT_MS = 12_000;

type CreateProjectCallbacks = {
  onCreated?: (project: ProjectNode) => void;
};

type CreateProjectSubmission = CreateProjectInput & { idempotencyKey?: string };

export const useProjects = () =>
  useQuery({
    queryKey: projectQueryKey,
    queryFn: ({ signal }) => requestApi<Page<ProjectNode>>(apiPath("/projects"), { signal }),
  });

/**
 * 创建项目。导航、提示等收尾动作通过 options 级回调注入，
 * 这样即使触发创建的组件已卸载（例如首页跳转到工作台），回调仍会执行。
 */
export const useCreateProject = (callbacks: CreateProjectCallbacks = {}) => {
  const queryClient = useQueryClient();
  const ownerId = useAuth().user?.id;
  const isCurrentUser = () => Boolean(ownerId && getAuthState().user?.id === ownerId);

  return useMutation<ProjectNode, Error, CreateProjectSubmission>({
    networkMode: "always",
    mutationFn: async ({ idempotencyKey, ...input }) => {
      if (!isCurrentUser()) throw new DOMException("登录会话已切换", "AbortError");

      const options = {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey ?? crypto.randomUUID() },
        signal: AbortSignal.timeout(PROJECT_CREATE_TIMEOUT_MS),
      };
      const projectOptions = { ...options, body: JSON.stringify(input) };
      const path = apiPath("/projects");
      let projectCreated = false;
      try {
        if (!FORMAL_API_ENABLED) return await requestApi<ProjectNode>(path, projectOptions);

        const project = await requestApi<Project>(path, projectOptions);
        if (!isCurrentUser()) throw new DOMException("登录会话已切换", "AbortError");
        projectCreated = true;
        options.signal.throwIfAborted();
        const conversation = await requestApi<Conversation>(
          apiPath(`/projects/${project.id}/conversations`),
          { ...options, body: "{}" },
        );
        return {
          ...project,
          lastActiveConversationId: conversation.id,
          assets: [],
          files: [],
          conversations: [{
            id: conversation.id,
            title: conversation.title,
            updatedAt: conversation.updatedAt,
          }],
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (projectCreated) {
          const message = error instanceof ApiError
            ? `项目已创建。${error.message}`
            : "项目已创建，暂时无法确认首个会话是否创建成功，请重试。";
          throw new Error(message, { cause: error });
        }
        if (error instanceof ApiError) throw error;
        throw new Error("暂时无法确认项目是否创建成功，请重试。", { cause: error });
      }
    },
    onSuccess: async (project) => {
      if (!isCurrentUser()) return;
      await queryClient.cancelQueries({ queryKey: projectQueryKey, exact: true });
      if (!isCurrentUser()) return;

      queryClient.setQueryData<Page<ProjectNode>>(projectQueryKey, (current) => ({
        items: [project, ...(current?.items.filter((item) => item.id !== project.id) ?? [])],
        nextCursor: current?.nextCursor ?? null,
        hasMore: current?.hasMore ?? false,
      }));
      callbacks.onCreated?.(project);
    },
  });
};
