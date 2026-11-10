"use client";

import { usePathname, useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  DEFAULT_PROJECT_NAME,
  useCreateProject,
} from "@/hooks/use-projects";

type CreateProjectButtonProps = {
  label?: string;
  className?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  /** 是否在请求期间切换为“正在创建…”。首页引导按钮不需要。 */
  showPendingState?: boolean;
};

export const CreateProjectButton = ({
  label = "新建项目",
  className,
  size = "default",
  variant = "default",
  showPendingState = true,
}: CreateProjectButtonProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const createProject = useCreateProject();

  const handleCreate = () => {
    const origin = pathname;
    const shouldEnterWorkspaceNow = pathname !== "/workspace";

    createProject.mutate(
      { name: DEFAULT_PROJECT_NAME },
      {
        onSuccess: (project) => {
          const conversationId = project.lastActiveConversationId;

          toast.success("项目已创建");
          router.replace(
            conversationId
              ? `/workspace?conversationId=${conversationId}`
              : "/workspace",
          );
        },
        onError: (error) => {
          toast.error(
            error instanceof Error ? error.message : "创建项目失败",
          );

          if (origin !== "/workspace") {
            router.push(origin);
          }
        },
      },
    );

    if (shouldEnterWorkspaceNow) {
      router.push("/workspace");
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleCreate}
    >
      {showPendingState && createProject.isPending ? (
        <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
      ) : (
        <Plus className="size-4" strokeWidth={2} />
      )}
      {showPendingState && createProject.isPending ? "正在创建…" : label}
    </Button>
  );
};
