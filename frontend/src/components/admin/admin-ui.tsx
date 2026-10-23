import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

function toneStyle(tone?: string): CSSProperties | undefined {
  return tone ? ({ ["--tone" as string]: tone } as CSSProperties) : undefined;
}

export function AdminPage({
  children,
  narrow = false,
  testId,
}: {
  children: ReactNode;
  narrow?: boolean;
  testId?: string;
}) {
  return (
    <main className={cn("mgr-page", narrow && "is-narrow")} data-testid={testId}>
      {children}
    </main>
  );
}

export function PageHead({
  kicker,
  title,
  description,
  actions,
  titleId,
  as: Heading = "h1",
}: {
  kicker?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
  as?: "h1" | "h2";
}) {
  return (
    <header className="mgr-head">
      <div className="mgr-head-copy">
        {kicker ? <p className="mgr-kicker">{kicker}</p> : null}
        <Heading id={titleId} className="mgr-title">
          {title}
        </Heading>
        {description ? <p className="mgr-sub">{description}</p> : null}
      </div>
      {actions ? <div className="mgr-head-tools">{actions}</div> : null}
    </header>
  );
}

/** A dark card with a title row. Renders a div so it never adds an extra landmark section. */
export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  tone,
  titleId,
  testId,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: string;
  titleId?: string;
  testId?: string;
}) {
  return (
    <div className={cn("mgr-card", tone && "has-tone", className)} style={toneStyle(tone)} data-testid={testId}>
      {title || action ? (
        <div className="mgr-card-head">
          <div>
            {title ? (
              <h2 id={titleId} className="mgr-card-title">
                {title}
              </h2>
            ) : null}
            {subtitle ? <p className="mgr-card-sub">{subtitle}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function StatGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <dl className="mgr-stats" aria-label={label}>
      {children}
    </dl>
  );
}

export function StatTile({
  label,
  value,
  note,
  tone,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: string;
  testId?: string;
}) {
  return (
    <div className="mgr-stat" style={toneStyle(tone)} data-testid={testId}>
      <dt className="mgr-stat-label">{label}</dt>
      <dd className="mgr-stat-value">{value}</dd>
      {note ? <dd className="mgr-stat-note">{note}</dd> : null}
    </div>
  );
}

export function Notice({
  children,
  tone = "info",
  testId,
}: {
  children: ReactNode;
  tone?: "info" | "success" | "error";
  testId?: string;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("mgr-notice", `is-${tone}`)}
      data-testid={testId}
    >
      {children}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="mgr-empty-state">{children}</p>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="mgr-range" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value || "all"}
          type="button"
          aria-pressed={value === option.value}
          className={cn(value === option.value && "is-active")}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count != null ? <span className="mgr-range-count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="mgr-skel-stack" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="mgr-skel mgr-skel-row" />
      ))}
    </div>
  );
}
