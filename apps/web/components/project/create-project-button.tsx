"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { CreateProjectInput } from "@arch-flow/shared";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  const nameId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(DEFAULT_PROJECT_NAME);
  const requestKey = useRef<string | null>(null);
  const submitting = useRef(false);
  const nameSchema = CreateProjectInput.shape.name;
  const parsedName = nameSchema.safeParse(name);
  const nameError = parsedName.success
    ? null
    : name.trim().length === 0
      ? "请输入项目名称。"
      : `项目名称最多 ${nameSchema.maxLength} 个字符。`;

  const createProject = useCreateProject({
    onCreated: (project) => {
      const conversationId = project.lastActiveConversationId;

      requestKey.current = null;
      setOpen(false);
      toast.success("项目已创建");
      router.replace(
        conversationId
          ? `/workspace?conversationId=${conversationId}`
          : "/workspace",
      );
    },
  });
  const { isPending, error } = createProject;

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting.current) return;
    requestKey.current = null;
    createProject.reset();
    setName(DEFAULT_PROJECT_NAME);
    setOpen(nextOpen);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!parsedName.success || submitting.current) return;

    requestKey.current ??= crypto.randomUUID();
    submitting.current = true;
    createProject.mutate(
      { name: parsedName.data, idempotencyKey: requestKey.current },
      {
        onSettled: () => {
          submitting.current = false;
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className} disabled={isPending}>
          {showPendingState && isPending ? (
            <Loader2 size={16} className="animate-spin" strokeWidth={1.75} />
          ) : (
            <Plus size={16} strokeWidth={2} />
          )}
          {showPendingState && isPending ? "正在创建…" : label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm" showCloseButton={!isPending}>
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>创建后会打开第一个会话。</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
          aria-busy={isPending}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-xs font-medium">
              项目名称
            </label>
            <Input
              id={nameId}
              value={name}
              disabled={isPending}
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? `${nameId}-error` : undefined}
              onChange={(event) => {
                setName(event.target.value);
                requestKey.current = null;
                if (error) createProject.reset();
              }}
            />
            {nameError && (
              <p id={`${nameId}-error`} className="text-xs text-destructive">
                {nameError}
              </p>
            )}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={isPending}>
                取消
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={!parsedName.success || isPending}>
              {isPending ? "正在创建…" : error ? "重试创建" : "创建项目"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
