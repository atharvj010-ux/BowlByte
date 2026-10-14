import * as React from "react";

import { cn } from "@/lib/utils";

function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium tracking-wide text-secondary-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
