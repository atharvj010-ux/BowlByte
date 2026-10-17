"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { CartProvider } from "@/components/cart/cart-provider";
import { SessionPrivacy } from "@/components/session-privacy";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SessionPrivacy />
      <CartProvider>{children}</CartProvider>
    </QueryClientProvider>
  );
}
