"use client";

import { useMemo, useRef } from "react";
import { Ellipsis, GitFork, RotateCcw } from "lucide-react";
import type { LooseGraph } from "@arch-flow/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { readMockGraph } from "@/lib/read-mock-graph";

type MessageActionsMenuProps = {
  snapshot: LooseGraph | null;
  disabled: boolean;
  onFork: (trigger: HTMLButtonElement | null) => void;
  onRestore?: (snapshot: LooseGraph, trigger: HTMLButtonElement | null) => void;
};

export const MessageActionsMenu = ({
  snapshot,
  disabled,
  onFork,
  onRestore,
}: MessageActionsMenuProps) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);
  const hasSnapshot = useMemo(
    () => readMockGraph(snapshot) !== null,
    [snapshot],
  );

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild ref={triggerRef}>
        <Button
          aria-label="消息操作"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
        >
          <Ellipsis size={14} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (openingDialog.current) event.preventDefault();
          openingDialog.current = false;
        }}
      >
        <DropdownMenuGroup>
          {snapshot && hasSnapshot && onRestore && (
            <DropdownMenuItem
              onSelect={() => {
                openingDialog.current = true;
                onRestore(snapshot, triggerRef.current);
              }}
            >
              <RotateCcw aria-hidden />
              恢复快照
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              openingDialog.current = true;
              onFork(triggerRef.current);
            }}
          >
            <GitFork aria-hidden />
            从此开启新会话
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
