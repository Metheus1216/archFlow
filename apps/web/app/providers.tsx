"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { connectAuthTabs, getAuthState, restoreSession, subscribeToAuthState } from "@/lib/api-client";

export const Providers = ({ children }: { children: ReactNode }) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failures, error) => error.name !== "AbortError" && failures < 1,
          },
        },
      }),
  );

  useEffect(() => {
    let userId = getAuthState().user?.id;
    const unsubscribe = subscribeToAuthState(() => {
      const nextUserId = getAuthState().user?.id;
      if (nextUserId !== userId) queryClient.clear();
      userId = nextUserId;
    });
    const disconnect = connectAuthTabs();
    if (getAuthState().status === "checking") void restoreSession();

    return () => {
      unsubscribe();
      disconnect?.();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};
