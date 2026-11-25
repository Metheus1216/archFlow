"use client";

import dynamic from "next/dynamic";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useCanvasDraft } from "@/hooks/use-canvas-draft";
import type { WorkspaceViewProps } from "@/types/workspace";
import { ChatPanel } from "./chat/chat-panel";

const CanvasPanel = dynamic(
  async () => (await import("./canvas/canvas-panel")).CanvasPanel,
  { ssr: false },
);

export const WorkspaceView = ({ conversationId }: WorkspaceViewProps) => {
  const draftActions = useCanvasDraft(conversationId);

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId="archflow-workspace-split"
      className="h-full"
    >
      <ResizablePanel defaultSize={52} minSize={32} className="min-w-0">
        <ChatPanel
          conversationId={conversationId}
          flushCanvasDraft={draftActions.flush}
          restoreSnapshot={draftActions.restoreSnapshot}
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={48} minSize={30} className="min-w-0">
        <CanvasPanel
          key={conversationId}
          conversationId={conversationId}
          draftActions={draftActions}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
