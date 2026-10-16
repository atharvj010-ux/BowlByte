"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-background/90 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-ivory backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {links.map((link) => {
          const current = pathname === link.href || (link.href !== "/student" && pathname.startsWith(link.href));
          const isCart = link.href === "/student/cart";
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={current ? "page" : undefined}
                data-cart-target={isCart ? "" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-sm ${current ? "text-lime" : "text-ivory/80"}`}
              >
                <span>
                  {link.label}
                  {isCart ? (
                    <>
                      {" "}
                      <motion.span
                        key={cart.landed}
                        className="inline-block"
                        initial={cart.landed ? { scale: 1.6, y: -4 } : false}
                        animate={{ scale: 1, y: 0 }}
                        transition={{ type: "spring", stiffness: 520, damping: 14 }}
                      >
                        {cart.count}
                      </motion.span>
                    </>
                  ) : null}
                </span>
                <span
                  aria-hidden="true"
                  className={`h-1 w-1 rounded-full ${current ? "bg-lime shadow-[0_0_8px_var(--lime)]" : "bg-transparent"}`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
