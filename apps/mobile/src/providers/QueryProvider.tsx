/**
 * Comadre Mobile — React Query provider.
 *
 * Configures @tanstack/react-query with conservative defaults for mobile:
 *  - staleTime: 30s (data considered fresh for 30 seconds)
 *  - retry: 1 for queries (one automatic retry before surfacing error)
 *  - DevTools disabled in production
 */

import React from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { QUERY_STALE_TIME_MS } from "../lib/constants";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        retry: 1,
        // Refetch on window focus is fine for mobile (app foreground)
        refetchOnWindowFocus: true,
      },
      mutations: {
        // Mutations should not retry by default — they are explicit user actions
        retry: 0,
      },
    },
  });
}

let clientQueryClientSingleton: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (!clientQueryClientSingleton) {
    clientQueryClientSingleton = makeQueryClient();
  }
  return clientQueryClientSingleton;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
