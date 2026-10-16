export type DishKind = "dosa" | "sandwich" | "fries" | "drink" | "bowl";

export function dishKind(name: string): DishKind {
  const value = name.toLowerCase();
  if (value.includes("dosa")) return "dosa";
  if (value.includes("sandwich") || value.includes("burger")) return "sandwich";
  if (value.includes("fries") || value.includes("maggi")) return "fries";
  if (
    value.includes("coffee") ||
    value.includes("coke") ||
    value.includes("cola") ||
    value.includes("chai") ||
    value.includes("juice") ||
    value.includes("drink") ||
    value.includes("shake")
  ) {
    return "drink";
  }
  return "bowl";
}

export function DishMark({ kind }: { kind: DishKind }) {
  return (
    <div className="food-plate" aria-hidden="true">
      <svg viewBox="0 0 120 80" className="h-24 w-36">
        {kind === "dosa" ? (
          <>
            <ellipse cx="60" cy="48" rx="46" ry="18" fill="#fff8ec" stroke="#191919" strokeWidth="3" />
            <path d="M24 46c6-22 66-22 72 0" fill="#c9842a" />
            <path d="M40 42c8-8 32-8 40 2" fill="#f15438" />
          </>
        ) : null}
        {kind === "sandwich" ? (
          <>
            <path d="M18 46c8-20 76-20 84 0v8H18z" fill="#f4eddd" stroke="#191919" strokeWidth="3" />
            <rect x="18" y="46" width="84" height="8" fill="#d5f25b" />
            <path d="M18 54h84v8c-8 12-76 12-84 0z" fill="#c9842a" stroke="#191919" strokeWidth="3" />
          </>
        ) : null}
        {kind === "fries" ? (
          <>
            <path d="M28 58 38 22h8l6 36z" fill="#f15438" />
            <path d="M48 58 54 18h8l8 40z" fill="#d5f25b" />
            <path d="M70 58 74 24h8l10 34z" fill="#c9842a" />
            <path d="M24 52h74l-8 16H34z" fill="#191919" />
          </>
        ) : null}
        {kind === "drink" ? (
          <>
            <path d="M34 22h52l-8 44H42z" fill="#f15438" />
            <path d="M40 30h38l-2 10H42z" fill="#fff8ec" opacity="0.35" />
            <rect x="54" y="14" width="12" height="10" rx="2" fill="#191919" />
            <path d="M66 18h16" stroke="#191919" strokeWidth="3" />
          </>
        ) : null}
        {kind === "bowl" ? (
          <>
            <path d="M18 36h84c-4 24-22 32-42 32S22 60 18 36z" fill="#fff8ec" stroke="#191919" strokeWidth="3" />
            <path d="M30 40h60c-2 12-14 18-30 18S32 52 30 40z" fill="#f15438" />
            <circle cx="52" cy="46" r="3" fill="#d5f25b" />
            <circle cx="68" cy="44" r="3" fill="#191919" />
          </>
        ) : null}
      </svg>
    </div>
  );
}
