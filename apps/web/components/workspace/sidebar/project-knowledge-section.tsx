"use client";

import type { FileBrief, FileStatus, ProjectNode } from "@arch-flow/shared";
import { Button } from "@/components/ui/button";
import { useDeleteFile } from "@/hooks/use-delete-project-items";
import { useProjectFileStatuses } from "@/hooks/use-project-files";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "./collapsible-section";
import { ItemActionsMenu } from "./item-actions-menu";
import { ProjectFileUpload } from "./project-file-upload";

const STATUS_LABELS: Record<FileStatus, string> = {
  processing: "解析中",
  ready: "可引用",
  failed: "解析失败",
  stored: "仅存储",
};

const getFileStatusLabel = ({ fileType, status }: FileBrief) =>
  fileType === "image" && status === "ready" ? "已解析" : STATUS_LABELS[status];

export const ProjectKnowledgeSection = ({ project }: { project: Pick<ProjectNode, "id" | "name" | "files"> }) => {
  const statuses = useProjectFileStatuses(project.id, project.files);
  const deleteFile = useDeleteFile();

  return (
    <CollapsibleSection
      kind="knowledge"
      label="知识库"
      action={<ProjectFileUpload projectId={project.id} projectName={project.name} />}
    >
      {project.files.length === 0 && (
        <p className="py-1 pl-8 text-[11px] text-muted-foreground">暂无项目资料</p>
      )}
      {project.files.some(({ fileType, status }) => fileType === "text" && status === "ready") && (
        <p className="py-1 pr-1 pl-8 text-[11px] text-muted-foreground">提问时写上文件名和要找的关键词。</p>
      )}
      {project.files.map((file) => (
        <div key={file.id} data-file-id={file.id} className="group/item rounded-md py-0.5 pr-1 pl-8 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground">
          <div className="flex min-h-6 min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate" title={file.fileName}>{file.fileName}</span>
            <span
              className={cn("shrink-0 text-[10px]", file.status === "failed" && "text-destructive")}
              title={file.status === "ready" && file.fileType === "image" ? "图片在本地不参与检索" : undefined}
            >
              {getFileStatusLabel(file)}
            </span>
            <ItemActionsMenu
              itemName={file.fileName}
              onDelete={() => deleteFile.mutate({ projectId: project.id, fileId: file.id, name: file.fileName })}
            />
          </div>
          {file.status === "failed" && (
            <p className="pr-1 pb-1 wrap-anywhere text-[10px] leading-4">
              {file.errorMessage || "该文件无法解析。请检查文件后删除这一份，再重新上传。"}
            </p>
          )}
        </div>
      ))}
      {project.files.some(({ status }) => status === "processing") && statuses.isError && (
        <div className="flex items-center gap-1 pl-8" role="status">
          <p className="flex-1 text-[11px] text-muted-foreground">暂时无法查询解析状态。</p>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => void statuses.refetch()} disabled={statuses.isFetching}>
            重试状态
          </Button>
        </div>
      )}
    </CollapsibleSection>
  );
};
