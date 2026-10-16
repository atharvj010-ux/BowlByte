import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KineticText } from "@/components/motion/kinetic";

describe("KineticText", () => {
  it("keeps one readable heading name while splitting letters", () => {
    render(<KineticText as="h1" mode="load" lines={["Good food.", "Zero queue drama."]} />);
    const heading = screen.getByRole("heading", { level: 1, name: "Good food. Zero queue drama." });
    expect(heading.textContent).toContain("Zero queue drama.");
    expect(heading.querySelectorAll(".kin-ch").length).toBe("Goodfood.Zeroqueuedrama.".length);
  });
});
