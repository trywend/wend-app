/**
 * Wend — TanStack Query client + provider.
 *
 * Server state (notes, agent runs, devices) will live here in later phases,
 * synced against the backend. Phase 1 just sets up the client + provider so the
 * root layout has it ready. Defaults tuned for a mobile offline-ish app: retry
 * once, don't refetch on window focus (RN has no window focus), keep data
 * reasonably fresh.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
