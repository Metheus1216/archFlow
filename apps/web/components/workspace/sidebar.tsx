import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  History,
  Plus,
  Settings,
  Sparkles,
  Workflow,
} from "lucide-react";
import { DevLogout } from "@/components/dev-logout";
import { BrandMark } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkspaceVariant } from "./types";

type NavItemProps = {
  icon: LucideIcon;
  label: string;
  href: string;
  active?: boolean;
  trailing?: boolean;
};

const NavItem = ({
  icon: Icon,
  label,
  href,
  active,
  trailing,
}: NavItemProps) => (
  <Link
    href={href}
    className={cn(
      "group flex h-8 items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
      active && "bg-secondary text-foreground",
    )}
  >
    <Icon className="size-3.5" strokeWidth={1.75} />
    <span className="truncate">{label}</span>
    {trailing && (
      <Plus className="ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-100" />
    )}
  </Link>
);

type SubItemProps = {
  label: string;
  href: string;
  active?: boolean;
};

const SubItem = ({ label, href, active }: SubItemProps) => (
  <Link
    href={href}
    className={cn(
      "flex h-7 items-center rounded-md pl-8 pr-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
      active && "bg-secondary text-foreground",
    )}
  >
    <span className="truncate">{label}</span>
  </Link>
);

const CollapsedProject = ({ label }: { label: string }) => (
  <div className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
    <ChevronRight className="size-3.5 shrink-0" strokeWidth={1.75} />
    <span className="truncate">{label}</span>
  </div>
);

const ProjectGroup = ({ children }: { children: ReactNode }) => (
  <div className="space-y-0.5">
    <div className="flex h-8 items-center gap-1.5 px-1.5 text-xs font-medium text-muted-foreground">
      <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="truncate">SaaS 数据分析平台</span>
    </div>
    {children}
  </div>
);

const USER_PROJECTS = [
  "电商推荐系统",
  "IoT 设备管理平台",
  "企业知识库",
  "实时协作白板",
  "智能客服系统",
  "内部开发者平台",
  "支付清算服务",
  "内容审核平台",
  "数据同步管道",
];

const Sidebar = ({ variant }: { variant: WorkspaceVariant }) => {
  const isAsset = variant === "asset";

  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-background">
      <div className="shrink-0 px-4 pb-4 pt-5">
        <Link href="/welcome" className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-sm font-semibold tracking-tight">ArchFlow</span>
        </Link>

        <div className="mt-5 space-y-2">
          <Link
            href="/welcome"
            className={cn(
              buttonVariants({ size: "default" }),
              "w-full justify-start",
            )}
          >
            <Plus className="size-4" strokeWidth={2} />
            新建项目
          </Link>
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

      <nav className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div className="space-y-1">
          <ProjectGroup>
            <NavItem icon={BookOpen} label="知识库" href="/workspace" trailing />
            <NavItem
              icon={Workflow}
              label="架构资产"
              href="/workspace/asset"
              active={isAsset}
              trailing
            />
            <SubItem
              label="方案 A：模块化单体"
              href="/workspace/asset"
            />
            <SubItem
              label="V1 基础架构"
              href="/workspace/asset"
              active={isAsset}
            />
            <NavItem
              icon={History}
              label="历史对话"
              href="/workspace"
              active={!isAsset}
              trailing
            />
            <SubItem
              label="讨论团队规模"
              href="/workspace"
              active={!isAsset}
            />
            <SubItem label="微服务拆分评估" href="/workspace" />
          </ProjectGroup>

          <div className="pt-1">
            {USER_PROJECTS.map((project) => (
              <CollapsedProject key={project} label={project} />
            ))}
          </div>
        </div>
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-secondary-foreground">
            YL
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">Yun Li</p>
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

export { Sidebar };
