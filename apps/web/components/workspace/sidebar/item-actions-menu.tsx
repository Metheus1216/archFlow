"use client";

import { MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ItemActionsMenuProps = {
  itemName: string;
  alwaysVisible?: boolean;
  onDelete?: () => void;
};

export const ItemActionsMenu = ({
  itemName,
  alwaysVisible = false,
  onDelete,
}: ItemActionsMenuProps) => {
  const handleAction = (action: string) => {
    toast.info(`“${itemName}”的${action}功能尚未接入`);
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete();
      return;
    }

    handleAction("删除");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${itemName} 更多操作`}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:outline-none data-[state=open]:opacity-100",
            alwaysVisible
              ? "opacity-100"
              : "opacity-0 group-hover/item:opacity-100",
          )}
        >
          <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="w-32">
        <DropdownMenuItem
          className="text-xs"
          onSelect={() => handleAction("置顶")}
        >
          <Pin className="size-3.5" strokeWidth={1.75} />
          置顶
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-xs"
          onSelect={() => handleAction("重命名")}
        >
          <Pencil className="size-3.5" strokeWidth={1.75} />
          重命名
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          className="text-xs"
          onSelect={handleDelete}
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
