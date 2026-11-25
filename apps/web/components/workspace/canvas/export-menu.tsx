"use client";

import { useRef, useState } from "react";
import { ChevronDown, Download, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AssetSaveSnapshot } from "./asset-save-snapshot";
import { SaveAssetDialog } from "./save-asset-dialog";

type ExportMenuProps = {
  defaultOpen?: boolean;
  captureAsset?: () => AssetSaveSnapshot | null;
};

export const ExportMenu = ({
  defaultOpen = false,
  captureAsset,
}: ExportMenuProps) => {
  const trigger = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);
  const [snapshot, setSnapshot] = useState<AssetSaveSnapshot | null>(null);

  const openSaveDialog = () => {
    const current = captureAsset?.();
    if (!current) return;
    openingDialog.current = true;
    setSnapshot(current);
  };

  return (
    <>
      <DropdownMenu defaultOpen={defaultOpen}>
        <DropdownMenuTrigger ref={trigger} asChild>
          <Button
            variant="outline"
            size="sm"
            className="group"
            disabled={!captureAsset}
          >
            <Download className="size-3.5" strokeWidth={1.75} />
            导出
            <ChevronDown
              className="size-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
              strokeWidth={1.75}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-52"
          onCloseAutoFocus={(event) => {
            if (!openingDialog.current) return;
            openingDialog.current = false;
            event.preventDefault();
          }}
        >
          <DropdownMenuItem
            className="px-2.5 py-2 text-xs"
            disabled={!captureAsset}
            onSelect={openSaveDialog}
          >
            <Save className="size-3.5" strokeWidth={1.75} />
            保存为项目资产
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SaveAssetDialog
        snapshot={snapshot}
        onClose={() => setSnapshot(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      />
    </>
  );
};
