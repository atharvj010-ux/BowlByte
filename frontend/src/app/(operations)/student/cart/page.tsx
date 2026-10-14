import type { Metadata } from "next";

import { CartDesk } from "@/components/menu/cart-desk";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Cart" };

export default function CartPage() {
  return (
    <ProtectedArea role="STUDENT" loginHref="/student/login">
      {() => (
        <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
          <CartDesk />
        </main>
      )}
    </ProtectedArea>
  );
}
