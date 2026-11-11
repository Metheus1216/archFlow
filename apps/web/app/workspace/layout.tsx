import { Suspense, type ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sidebar } from "@/components/workspace/sidebar/sidebar";
import { SidebarSkeleton } from "@/components/workspace/sidebar/sidebar-skeleton";
import { listProjectNodes } from "@/lib/mock-db";

export const dynamic = "force-dynamic";

/**
 * 项目树单独抽成异步组件并放进 <Suspense>。
 *
 * layout 本身保持同步，右侧 page 不必等项目树查完就能先流式输出；
 * 项目树较慢时用户先看到页面骨架，而不是整页空白。
 */
const SidebarSection = async () => {
  const projects = await listProjectNodes();

  return <Sidebar projects={projects} />;
};

const WorkspaceLayout = ({ children }: { children: ReactNode }) => (
  <div className="h-dvh overflow-x-auto bg-background text-foreground">
    <div className="h-full min-w-[1180px]">
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="archflow-workspace"
        className="h-full"
      >
        <ResizablePanel
          defaultSize={20}
          minSize={15}
          maxSize={30}
          className="min-w-0"
        >
          <Suspense fallback={<SidebarSkeleton />}>
            <SidebarSection />
          </Suspense>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={80} minSize={50} className="min-w-0">
          {children}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  </div>
);

export default WorkspaceLayout;
