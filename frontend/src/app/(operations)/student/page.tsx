import type { Metadata } from "next";
import Link from "next/link";

import { AccountHome } from "@/components/account-home";
import { ProtectedArea } from "@/components/protected-area";

export const metadata: Metadata = { title: "Students" };

export default function StudentPage() {
  return (
    <ProtectedArea role="STUDENT" loginHref="/student/login">
      {(user) => (
        <AccountHome
          user={user}
          note="Browse the menu and place a counter order. When it is ready, pay cash at the counter and show your pickup QR."
          extra={
            <nav className="flex flex-wrap gap-3 text-sm" aria-label="Student">
              <Link href="/student/menu" className="underline-offset-4 hover:underline">
                Menu
              </Link>
              <Link href="/student/cart" className="underline-offset-4 hover:underline">
                Cart
              </Link>
              <Link href="/student/orders" className="underline-offset-4 hover:underline">
                Orders
              </Link>
              <Link href="/student/notifications" className="underline-offset-4 hover:underline">
                Notifications
              </Link>
              <Link href="/student/profile" className="underline-offset-4 hover:underline">
                Profile
              </Link>
            </nav>
          }
        />
      )}
    </ProtectedArea>
  );
}
