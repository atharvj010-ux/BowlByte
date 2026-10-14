import type { ReactNode } from "react";

export default function OperationsLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <div className="border-b border-accent/30 bg-accent/15">
        <p className="mx-auto w-full max-w-6xl px-4 py-3 text-sm leading-6 sm:px-6">
          Future protected area. Authentication is not implemented, so this screen does not check a
          session and does not expose canteen operations.
        </p>
      </div>
      {children}
    </div>
  );
}
