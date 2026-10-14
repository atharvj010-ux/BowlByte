import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MenuCard } from "@/components/menu/menu-card";
import type { MenuItem } from "@/lib/ordering";

const item: MenuItem = {
  id: "1",
  category_id: "c",
  category_name: "Snacks",
  station_id: "s",
  station_name: "Sandwich Station",
  name: "Veg Sandwich",
  description: "Toasted vegetables",
  price_paise: 4000,
  prep_seconds: 300,
  is_active: true,
  is_available: true,
  is_demo: true,
  image_url: null,
  available_qty: 0,
};

describe("MenuCard", () => {
  it("shows the rupee price and an unavailable item", () => {
    render(<MenuCard item={item} action={<button type="button" disabled>Unavailable</button>} />);
    expect(screen.getByRole("heading", { name: "Veg Sandwich" })).toBeInTheDocument();
    expect(screen.getByText("₹40.00")).toBeInTheDocument();
    expect(screen.getByText(/· Unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unavailable" })).toBeDisabled();
  });
});
