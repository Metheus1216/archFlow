"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProjectNode } from "@arch-flow/shared";
import {
  useDeleteAsset,
  useDeleteProject,
} from "@/hooks/use-delete-project-items";
import { AssetPreviewDialog } from "./asset-preview-dialog";
import { CollapsibleSection } from "./collapsible-section";
import { ConversationLink } from "./conversation-link";
import { ItemActionsMenu } from "./item-actions-menu";
import { NewConversationButton } from "./new-conversation-button";
import { ProjectKnowledgeSection } from "./project-knowledge-section";

type SectionItemProps = {
  label: string;
  onDelete: () => void;
  children?: ReactNode;
};

const SectionItem = ({ label, onDelete, children }: SectionItemProps) => (
  <div className="group/item flex h-7 items-center rounded-md pl-8 pr-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
    {children ?? <span className="min-w-0 flex-1 truncate">{label}</span>}
    <ItemActionsMenu itemName={label} onDelete={onDelete} />
  </div>
);

export const ProjectGroup = ({ project }: { project: ProjectNode }) => {
  const [open, setOpen] = useState(true);
  const searchParams = useSearchParams();
  const activeConversationId = searchParams.get("conversationId");
  const deleteProject = useDeleteProject();
  const deleteAsset = useDeleteAsset();
  const Chevron = open ? ChevronDown : ChevronRight;

  const handleDeleteProject = () => {
    deleteProject.mutate({
      projectId: project.id,
      name: project.name,
      isActive: project.conversations.some(
        (conversation) => conversation.id === activeConversationId,
      ),
    });
  };

  return (
    <div className="space-y-0.5">
      <div className="flex h-8 items-center rounded-md pl-1.5 pr-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left"
        >
          <span className="truncate">{project.name}</span>
          <Chevron className="size-3.5 shrink-0" strokeWidth={1.75} />
        </button>
        <ItemActionsMenu
          itemName={project.name}
          alwaysVisible
          onDelete={handleDeleteProject}
        />
      </div>

      {open && (
        <div className="space-y-1">
          <ProjectKnowledgeSection project={project} />

          <CollapsibleSection kind="assets" label="资产库">
            {project.assets.map((asset) => (
              <SectionItem
                key={asset.id}
                label={asset.name}
                onDelete={() =>
                  deleteAsset.mutate({
                    projectId: project.id,
                    assetId: asset.id,
                    name: asset.name,
                  })
                }
              >
                <AssetPreviewDialog projectId={project.id} asset={asset} />
              </SectionItem>
            ))}
          </CollapsibleSection>

          <CollapsibleSection
            kind="conversations"
            label="历史会话"
            action={<NewConversationButton projectId={project.id} />}
          >
            {project.conversations.map((conversation) => (
              <ConversationLink
                key={conversation.id}
                projectId={project.id}
                conversationId={conversation.id}
                title={conversation.title}
              />
            ))}
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
};
