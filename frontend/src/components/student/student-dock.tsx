"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useCart } from "@/components/cart/cart-provider";

const links = [
  { href: "/student", label: "Home" },
  { href: "/student/menu", label: "Menu" },
  { href: "/student/cart", label: "Cart" },
  { href: "/student/orders", label: "Orders" },
];

export function StudentDock() {
  const pathname = usePathname();
  const cart = useCart();
  return (
    <nav
      aria-label="Student"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-ivory/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {links.map((link) => {
          const current = pathname === link.href || (link.href !== "/student" && pathname.startsWith(link.href));
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={current ? "page" : undefined}
                className="flex min-h-14 flex-col items-center justify-center text-sm"
              >
                {link.label}
                {link.href === "/student/cart" ? ` ${cart.count}` : ""}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
