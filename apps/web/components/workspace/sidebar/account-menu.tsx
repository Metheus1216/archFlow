"use client";

import { useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearSessionHint } from "@/lib/session";

/** 底部账户设置菜单。当前只有开发环境可见的“退出登录”。 */
export const AccountMenu = () => {
  const router = useRouter();

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const handleLogout = () => {
    clearSessionHint();
    router.replace("/login");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="设置"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Settings className="size-3.5" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={6}
        className="w-36"
      >
        <DropdownMenuItem className="text-xs" onSelect={handleLogout}>
          <LogOut className="size-3.5" strokeWidth={1.75} />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
