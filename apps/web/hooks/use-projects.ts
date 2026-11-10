"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PageSchema,
  ProjectNode as projectNodeSchema,
  type CreateProjectInput,
  type Page,
  type ProjectNode,
} from "@arch-flow/shared";
import { requestApi } from "@/lib/api-client";

const projectPageSchema = PageSchema(projectNodeSchema);

export const projectQueryKey = ["projects"] as const;

export const DEFAULT_PROJECT_NAME = "新架构项目";

type CreateProjectContext = {
  previous: Page<ProjectNode> | undefined;
  optimisticId: string;
};

const buildOptimisticProject = (input: CreateProjectInput): ProjectNode => {
  const now = new Date().toISOString();
  const conversationId = crypto.randomUUID();

  return {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
    lastActiveConversationId: conversationId,
    files: [
      {
        id: crypto.randomUUID(),
        fileName: "需求说明.md",
        fileType: "text",
        status: "ready",
        createdAt: now,
      },
    ],
    assets: [
      {
        id: crypto.randomUUID(),
        name: "初始架构",
        createdAt: now,
      },
    ],
    conversations: [
      {
        id: conversationId,
        title: "新会话",
        updatedAt: now,
      },
    ],
  };
};

export const useProjects = (initialProjects?: ProjectNode[]) =>
  useQuery({
    queryKey: projectQueryKey,
    queryFn: async () => requestApi("/api/mock/projects", projectPageSchema),
    initialData: initialProjects
      ? { items: initialProjects, nextCursor: null, hasMore: false }
      : undefined,
  });

export const useCreateProject = () => {
  const queryClient = useQueryClient();

  return useMutation<ProjectNode, Error, CreateProjectInput, CreateProjectContext>({
    mutationFn: async (input) =>
      requestApi("/api/mock/projects", projectNodeSchema, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onMutate: (input) => {
      const previous =
        queryClient.getQueryData<Page<ProjectNode>>(projectQueryKey);
      const optimistic = buildOptimisticProject(input);

      queryClient.setQueryData<Page<ProjectNode>>(projectQueryKey, (current) => ({
        items: [optimistic, ...(current?.items ?? [])],
        nextCursor: current?.nextCursor ?? null,
        hasMore: current?.hasMore ?? false,
      }));

      return { previous, optimisticId: optimistic.id };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(projectQueryKey, context.previous);
        return;
      }

      queryClient.removeQueries({ queryKey: projectQueryKey });
    },
    onSuccess: (project, _input, context) => {
      queryClient.setQueryData<Page<ProjectNode>>(projectQueryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === context?.optimisticId ? project : item,
              ),
            }
          : current,
      );

      void queryClient.invalidateQueries({ queryKey: projectQueryKey });
    },
  });
};
