import { describe, expect, it } from "vitest";

import { liveStatusLabel } from "@/lib/live";

describe("live status labels", () => {
  it("names the four connection states without a permanent checking message", () => {
    expect(liveStatusLabel("live")).toBe("Live updates connected");
    expect(liveStatusLabel("reconnecting")).toBe("Reconnecting");
    expect(liveStatusLabel("polling")).toBe("Polling for updates");
    expect(liveStatusLabel("offline")).toBe("Offline");
    expect(
      [liveStatusLabel("live"), liveStatusLabel("reconnecting"), liveStatusLabel("polling"), liveStatusLabel("offline")].join(
        " ",
      ),
    ).not.toContain("Checking");
  });
});
