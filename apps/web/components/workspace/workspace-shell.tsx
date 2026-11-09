import { Toaster } from "@/components/ui/sonner";
import { CanvasPanel } from "./canvas-panel";
import { ChatPanel } from "./chat-panel";
import { Sidebar } from "./sidebar";
import type { WorkspaceVariant } from "./types";

const WorkspaceShell = ({ variant }: { variant: WorkspaceVariant }) => (
  <div className="h-dvh overflow-x-auto bg-background text-foreground">
    <div className="grid h-full min-w-[1180px] grid-cols-[280px_minmax(360px,34%)_1fr] overflow-hidden">
      <Sidebar variant={variant} />
      <ChatPanel />
      <CanvasPanel variant={variant} />
    </div>
    <Toaster position="bottom-right" offset={{ bottom: 64, right: 12 }} />
  </div>
);

export { WorkspaceShell };
