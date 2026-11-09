"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const CONFLICT_TOAST_ID = "draft-version-conflict";

const ConflictToast = () => {
  useEffect(() => {
    const dismiss = () => {
      toast.dismiss(CONFLICT_TOAST_ID);
    };

    toast("版本冲突", {
      id: CONFLICT_TOAST_ID,
      description: "画布已在其他设备修改，请刷新重试。",
      duration: Infinity,
      closeButton: true,
      icon: <AlertTriangle className="size-4" strokeWidth={1.75} />,
      classNames: {
        toast: "font-sans",
        title: "text-xs font-medium",
        description: "text-[11px] leading-5 text-muted-foreground!",
        cancelButton:
          "bg-transparent! text-muted-foreground! hover:text-foreground!",
      },
      action: {
        label: "刷新",
        onClick: dismiss,
      },
      cancel: {
        label: "稍后",
        onClick: dismiss,
      },
    });

    return dismiss;
  }, []);

  return null;
};

export { ConflictToast };
