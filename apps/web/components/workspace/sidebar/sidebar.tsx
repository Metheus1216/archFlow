import Link from "next/link";
import { Settings, Sparkles } from "lucide-react";
import type { ProjectNode } from "@arch-flow/shared";
import { DevLogout } from "@/components/dev-logout";
import { BrandMark } from "@/components/logo";
import { CreateProjectButton } from "@/components/project/create-project-button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProjectList } from "./project-list";

export const Sidebar = ({ projects }: { projects: ProjectNode[] }) => {
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border bg-background">
      <div className="shrink-0 px-4 pb-4 pt-5">
        <div className="flex items-center gap-2.5">
          <Link href="/" aria-label="返回首页">
            <BrandMark />
          </Link>
          <span className="text-sm font-semibold tracking-tight">ArchFlow</span>
        </div>

        <div className="mt-5 space-y-2">
          <CreateProjectButton className="w-full justify-start" />
          <button
            type="button"
            className={cn(
              buttonVariants({ variant: "outline", size: "default" }),
              "w-full justify-start text-muted-foreground",
            )}
          >
            <Sparkles className="size-3.5" strokeWidth={1.75} />
            添加 Skill
          </button>
        </div>
      </div>

      <div className="mx-4 border-t border-border" />

      <nav className="arch-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <ProjectList initialProjects={projects} />
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-secondary-foreground">
            AF
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">开发者</p>
            <p className="truncate text-[10px] text-muted-foreground">
              个人空间
            </p>
          </div>
          <DevLogout />
          <button
            type="button"
            aria-label="设置"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Settings className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </aside>
  );
};
