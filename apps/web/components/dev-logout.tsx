"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { clearSessionHint } from "@/lib/session";

const DevLogout = () => {
  const router = useRouter();

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const handleLogout = () => {
    clearSessionHint();
    router.replace("/login");
  };

  return (
    <button
      type="button"
      aria-label="退出登录（开发环境）"
      title="退出登录（开发环境）"
      onClick={handleLogout}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <LogOut className="size-3.5" strokeWidth={1.75} />
    </button>
  );
};

export { DevLogout };
