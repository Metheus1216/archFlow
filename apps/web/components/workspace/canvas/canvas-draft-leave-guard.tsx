"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { watchUnsavedCanvasDrafts } from "@/lib/canvas-draft-edits";

export const CanvasDraftLeaveGuard = () => {
  const queryClient = useQueryClient();
  useEffect(() => watchUnsavedCanvasDrafts(queryClient, window), [queryClient]);
  return null;
};
