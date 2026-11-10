"use client";

import { useState, type ReactNode } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  History,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SECTION_ICONS = {
  knowledge: BookOpen,
  assets: Workflow,
  conversations: History,
} as const;

type SectionKind = keyof typeof SECTION_ICONS;

type CollapsibleSectionProps = {
  kind: SectionKind;
  label: string;
  children: ReactNode;
};

export const CollapsibleSection = ({
  kind,
  label,
  children,
}: CollapsibleSectionProps) => {
  const [open, setOpen] = useState(true);
  const Icon = SECTION_ICONS[kind];
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group/section flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{label}</span>
        <Chevron
          className={cn(
            "size-3 shrink-0 transition-opacity",
            open ? "opacity-0 group-hover/section:opacity-100" : "opacity-100",
          )}
          strokeWidth={1.75}
        />
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
};
