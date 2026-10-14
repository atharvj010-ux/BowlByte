import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ErrorState } from "@/components/states/error-state";

describe("ErrorState", () => {
  it("calls the retry handler", () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Failed" message="The request did not finish." onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
