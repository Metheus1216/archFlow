"use client";

import { useSyncExternalStore } from "react";
import { getAuthState, getInitialAuthState, subscribeToAuthState } from "@/lib/api-client";

export const useAuth = () =>
  useSyncExternalStore(subscribeToAuthState, getAuthState, getInitialAuthState);
