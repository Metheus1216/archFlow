"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { ItemActionsMenu } from "./item-actions-menu";

type ConversationLinkProps = {
  conversationId: string;
  title: string;
  onDelete?: () => void;
};

export const ConversationLink = ({
  conversationId,
  title,
  onDelete,
}: ConversationLinkProps) => {
  const searchParams = useSearchParams();
  const active = searchParams.get("conversationId") === conversationId;

  return (
    <div
      className={cn(
        "group/item flex h-7 items-center rounded-md pl-8 pr-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        active && "bg-secondary text-foreground",
      )}
    >
      <Link
        href={`/workspace?conversationId=${conversationId}`}
        className="flex min-w-0 flex-1 items-center self-stretch"
      >
        <span className="truncate">{title}</span>
      </Link>
      <ItemActionsMenu itemName={title} onDelete={onDelete} />
    </div>
  );
};
