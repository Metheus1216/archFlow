import type { LucideIcon } from "lucide-react";
import {
  Code2,
  Database,
  Layers,
  Server,
  Shield,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

type GraphNode = {
  id: string;
  eyebrow: string;
  label: string;
  meta?: string;
  icon: LucideIcon;
  left: string;
  top: string;
  dragging?: boolean;
};

const GRAPH_NODES: GraphNode[] = [
  {
    id: "client",
    eyebrow: "客户端",
    label: "React Web App",
    icon: Code2,
    left: "50%",
    top: "14%",
  },
  {
    id: "gateway",
    eyebrow: "边界层",
    label: "API Gateway",
    icon: Shield,
    left: "50%",
    top: "30%",
  },
  {
    id: "auth",
    eyebrow: "身份认证",
    label: "Auth Service",
    icon: ShieldCheck,
    left: "18%",
    top: "54%",
  },
  {
    id: "api",
    eyebrow: "核心服务",
    label: "Application API",
    meta: "Node.js · REST",
    icon: Server,
    left: "50%",
    top: "54%",
    dragging: true,
  },
  {
    id: "worker",
    eyebrow: "异步任务",
    label: "Query Worker",
    icon: Layers,
    left: "82%",
    top: "54%",
  },
  {
    id: "postgres",
    eyebrow: "主数据库",
    label: "PostgreSQL",
    icon: Database,
    left: "28%",
    top: "82%",
  },
  {
    id: "redis",
    eyebrow: "高速缓存",
    label: "Redis",
    icon: Database,
    left: "72%",
    top: "82%",
  },
];

const EDGES = [
  "M50 14 L50 30",
  "M50 30 C50 40 18 44 18 54",
  "M50 30 C50 40 50 44 50 54",
  "M50 30 C50 40 82 44 82 54",
  "M18 54 C18 68 28 68 28 82",
  "M82 54 C82 68 72 68 72 82",
];

const SELECTION_HANDLES = [
  "-left-[3px] -top-[3px]",
  "-right-[3px] -top-[3px]",
  "-bottom-[3px] -left-[3px]",
  "-bottom-[3px] -right-[3px]",
];

const ArchitectureCanvas = ({ isEditing = false }: { isEditing?: boolean }) => (
  <div className="relative h-full w-full">
    <svg
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {EDGES.map((path) => (
        <path
          key={path}
          d={path}
          fill="none"
          stroke="var(--edge)"
          strokeWidth={1.25}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>

    {GRAPH_NODES.map((node) => {
      const Icon = node.icon;
      const isDragging = isEditing && node.dragging === true;

      return (
        <div
          key={node.id}
          className="absolute z-10 w-[172px] -translate-x-1/2 -translate-y-1/2"
          style={{
            left: isDragging ? "calc(50% + 12px)" : node.left,
            top: isDragging ? "calc(54% - 8px)" : node.top,
          }}
        >
          {isDragging && (
            <>
              <div className="pointer-events-none absolute -inset-3 rounded-xl border border-dashed border-foreground/60" />
              {SELECTION_HANDLES.map((position) => (
                <span
                  key={position}
                  className={cn(
                    "pointer-events-none absolute size-1.5 rounded-[2px] border border-foreground bg-background",
                    position,
                  )}
                />
              ))}
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">
                拖拽中
              </div>
            </>
          )}

          <div className="rounded-lg border border-border bg-card px-3.5 py-3">
            <div className="flex items-start gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <Icon className="size-4" strokeWidth={1.6} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[10px] leading-4 text-muted-foreground">
                  {node.eyebrow}
                </p>
                <p className="truncate text-[12px] font-medium leading-5">
                  {node.label}
                </p>
                {node.meta && (
                  <p className="truncate text-[10px] leading-4 text-muted-foreground">
                    {node.meta}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    })}
  </div>
);

export { ArchitectureCanvas };
