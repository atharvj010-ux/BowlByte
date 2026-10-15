export const fulfillmentPath = [
  "PLACED",
  "ACCEPTED",
  "QUEUED",
  "PREPARING",
  "READY",
  "PICKED_UP",
] as const;

export const fulfillmentExits = ["REJECTED", "CANCELLED", "UNCLAIMED"] as const;

export const operatingRules = [
  {
    title: "Cash only",
    body: "Payment starts as PENDING. A cashier or manager records PAID after counting the cash. Students cannot change that status.",
  },
  {
    title: "Cook, then collect",
    body: "The kitchen may prepare an order while payment is still PENDING. PICKED_UP is allowed only after payment is PAID.",
  },
  {
    title: "Counter pickup",
    body: "Version 1 hands food over at the counter. There is no delivery, and there is no online payment gateway.",
  },
] as const;

export const releaseNotes = {
  available: [
    "Student registration, email confirmation, and server sessions",
    "Manager bootstrap and staff invitations",
    "Menu, daily portions, and cash-pending orders",
    "Kitchen queue, preparation tracking, and approximate readiness estimates",
    "Cash confirmation, one-time QR pickup, and in-app notifications",
    "Web Push notifications for installed or enabled browsers",
    "API liveness and readiness checks against PostgreSQL and Redis",
  ],
  unavailable: [
    "Online payments of any kind",
    "Demand forecasting",
  ],
} as const;

export const roles = [
  {
    href: "/student",
    label: "Students",
    navLabel: "Students",
    indexTitle: "Student area",
    summary: "Browse the menu, place an order, and collect it at the counter after cash is recorded.",
    responsibilities: [
      "Self-register and verify an email address",
      "Place a counter-pickup order",
      "Watch preparation and bring the pickup QR to the cashier",
    ],
  },
  {
    href: "/staff",
    label: "Kitchen",
    navLabel: "Kitchen",
    indexTitle: "Kitchen",
    summary: "Move accepted tickets from the queue to READY. Kitchen staff do not record cash.",
    responsibilities: [
      "Accept, queue, and prepare orders",
      "Mark an order READY when it is at the counter",
      "Reject a ticket only before it enters the queue",
    ],
  },
  {
    href: "/cashier",
    label: "Cashier",
    navLabel: "Cashier",
    indexTitle: "Cashier",
    summary: "Confirm the cash amount, then hand the order over as a separate step.",
    responsibilities: [
      "Record CASH as PAID only after counting the correct amount",
      "Refuse pickup while payment is still PENDING",
      "Mark an unclaimed READY order after the hold window",
    ],
  },
  {
    href: "/admin",
    label: "Manager",
    navLabel: "Manager",
    indexTitle: "Canteen manager",
    summary: "Provision staff and own the menu, stations, stock, corrections, and reports.",
    responsibilities: [
      "Create kitchen and cashier access for this canteen",
      "Publish menu prices in integer paise",
      "Void a mistaken cash receipt with a written reason",
    ],
  },
] as const;

export type RoleHref = (typeof roles)[number]["href"];

export function roleByHref(href: RoleHref) {
  const role = roles.find((item) => item.href === href);
  if (!role) {
    throw new Error(`Unknown role route: ${href}`);
  }
  return role;
}
