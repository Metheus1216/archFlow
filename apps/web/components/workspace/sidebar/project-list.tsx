"use client";

import type { ProjectNode } from "@arch-flow/shared";
import { useProjects } from "@/hooks/use-projects";
import { ProjectGroup } from "./project-group";

type ProjectListProps = {
  initialProjects: ProjectNode[];
};

export const ProjectList = ({ initialProjects }: ProjectListProps) => {
  const projects = useProjects(initialProjects);
  const items = projects.data?.items ?? initialProjects;

  if (items.length === 0) {
    return (
      <div className="mx-1 rounded-lg border border-dashed border-border px-3 py-4">
        <p className="text-xs font-medium">还没有项目</p>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          点击上方“新建项目”，开始描述你的架构约束。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((project) => (
        <ProjectGroup key={project.id} project={project} />
      ))}
    </div>
  );
};
