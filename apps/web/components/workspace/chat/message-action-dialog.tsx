"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ERROR_CODES } from "@arch-flow/shared/constants/error-codes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";

const ACTION_COPY = {
  restore: {
    title: "恢复快照",
    description:
      "将用这条消息保存的架构图替换当前画布，恢复时会重新排列节点。历史消息会保留。",
    confirm: "确认恢复",
    pending: "正在恢复…",
    failure: "恢复快照失败，请重试。",
  },
  fork: {
    title: "从此开启新会话",
    description:
      "新会话会包含这条消息及之前的对话，并在有快照时以当时的架构图作为新画布。",
    confirm: "开启新会话",
    pending: "正在开启…",
    failure: "开启新会话失败，请重试。",
  },
} as const;

type MessageActionDialogProps = {
  action: keyof typeof ACTION_COPY;
  trigger: HTMLButtonElement | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export const MessageActionDialog = ({
  action,
  trigger,
  onClose,
  onConfirm,
}: MessageActionDialogProps) => {
  const confirming = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const copy = ACTION_COPY[action];
  const versionConflict =
    action === "restore" &&
    error instanceof ApiError &&
    error.code === ERROR_CODES.DRAFT_VERSION_CONFLICT;
  const errorMessage = versionConflict
    ? "画布已有新版。请关闭此窗口，确认最新画布后再恢复。"
    : error?.message;

  const confirm = async () => {
    if (confirming.current || versionConflict) return;
    confirming.current = true;
    setPending(true);
    setError(null);

    try {
      await onConfirm();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error : new Error(copy.failure));
    } finally {
      confirming.current = false;
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !confirming.current) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-sm"
        showCloseButton={!pending}
        aria-busy={pending}
        onCloseAutoFocus={(event) => {
          if (!trigger?.isConnected) return;
          event.preventDefault();
          trigger.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {errorMessage && (
          <p role="alert" className="text-xs text-destructive">
            {errorMessage}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" disabled={pending}>
              取消
            </Button>
          </DialogClose>
          <Button
            size="sm"
            disabled={pending || versionConflict}
            onClick={() => void confirm()}
          >
            {pending && (
              <Loader2
                data-icon="inline-start"
                className="animate-spin"
                size={14}
                aria-hidden
              />
            )}
            {pending ? copy.pending : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
