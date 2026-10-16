"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { DishMark, type DishKind } from "@/components/menu/food-mark";
import { Button } from "@/components/ui/button";

let entrancePlayed = false;

const journey = [
  ["Discover", "See what the canteen actually has in stock."],
  ["Order", "The price is confirmed when you place the ticket."],
  ["Kitchen", "A station queue writes the estimate. It is not a promise."],
  ["Pickup", "Pay cash at the counter. The QR works once."],
];

const plates = [
  ["Dosa", "dosa"],
  ["Sandwich", "sandwich"],
  ["Fries", "fries"],
  ["Cold coffee", "drink"],
] as const;

export function LandingExperience() {
  const [welcome, setWelcome] = useState(false);
  const [scene, setScene] = useState<"hold" | "play" | "settled">("hold");

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || entrancePlayed) {
      const settle = window.setTimeout(() => setScene("settled"), 0);
      return () => window.clearTimeout(settle);
    }
    const show = window.setTimeout(() => {
      entrancePlayed = true;
      setScene("play");
      setWelcome(true);
    }, 0);
    const done = window.setTimeout(() => setWelcome(false), 4800);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(done);
    };
  }, []);

  return (
    <main className="cine overflow-x-clip">
      <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 pt-10 pb-4 text-center sm:px-6">
        <p className="text-xs font-medium tracking-[0.28em] text-chili uppercase">Cravings in motion</p>
        <h1 className="mt-4 font-display text-5xl leading-[0.86] tracking-tight text-ivory sm:text-7xl">
          Good food.
          <br />
          Zero queue drama.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-8 text-ivory/80">
          Order before the rush. Follow your food from kitchen to counter.
        </p>
        <div className="mt-6 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
          <Button asChild>
            <Link href="/student/menu">Explore menu</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="#how-it-works">How it works</Link>
          </Button>
        </div>
        {welcome ? (
          <div className="mt-6 flex w-full max-w-md items-center justify-between text-sm" data-testid="welcome">
            <p className="tracking-[0.18em] text-lime uppercase">Lights on</p>
            <button type="button" className="min-h-11 underline" onClick={() => setWelcome(false)}>
              Skip
            </button>
          </div>
        ) : null}
        <JourneyScene scene={scene} />
        <ul className="mt-2 grid w-full max-w-3xl grid-cols-2 gap-2 text-left text-xs tracking-[0.14em] text-ivory/70 uppercase sm:grid-cols-4">
          <li className="text-[#f6d15a]">Discover food</li>
          <li className="text-[#3dff8a]">Place order</li>
          <li className="text-[#4db4ff]">Kitchen</li>
          <li className="text-[#ff4fa3]">Pickup</li>
        </ul>
      </section>

      <section className="reel" aria-label="Cravings">
        <div className="reel-pin">
          <h2 className="reel-word reel-a" aria-label="Cravings">
            Cravings
          </h2>
          <h2 className="reel-word reel-b" aria-label="Made fresh">
            Made fresh
          </h2>
          <div className="reel-food">
            {plates.map(([name, kind]) => (
              <article key={name} className="min-w-0 rounded-[1.4rem] border border-border bg-card/80 p-3">
                <DishMark kind={kind as DishKind} />
                <h3 className="mt-2 font-display text-xl">{name}</h3>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <p className="text-lg leading-8 text-ivory/80">
          Each portion sits on a station with a capacity. The ready time is written with the kitchen update.
        </p>
      </section>

      <section id="how-it-works" className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <h2 className="mega">
          From craving
          <br />
          to counter.
        </h2>
        <ol className="grid gap-4 md:grid-cols-4">
          {journey.map(([title, body], index) => (
            <li key={title} className="rounded-[1.5rem] border border-border bg-card p-5 text-left">
              <p className="text-lime">0{index + 1}</p>
              <h3 className="mt-2 font-display text-2xl">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-ivory/75">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="reel" aria-label="Ready to go">
        <div className="reel-pin">
          <h2 className="reel-word reel-a">The kitchen</h2>
          <h2 className="reel-word reel-b">Ready to go</h2>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-8 sm:px-6 lg:grid-cols-2">
        <article className="rounded-[1.5rem] bg-card p-6">
          <p className="mega text-[clamp(2.6rem,8vw,4.5rem)]">Ready. Pay. Pick up.</p>
          <h2 className="mt-4 font-display text-3xl">Cash at the counter</h2>
          <p className="mt-3 leading-7 text-ivory/80">
            Payment starts pending. A cashier records the notes, then the QR works once. There is no online payment.
          </p>
        </article>
        <article className="rounded-[1.5rem] bg-lime p-6 text-ink">
          <h2 className="font-display text-4xl">BowlByte intelligence</h2>
          <p className="mt-3 leading-7">
            Managers can record production, waste, and a forecast they must approve. Demo scores are labeled as demo. They are not a measured drop in waste.
          </p>
        </article>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <h2 className="font-display text-5xl tracking-tight">Not in this release</h2>
        <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <li>Online payments of any kind</li>
          <li>A public HTTPS site and observed phone notifications</li>
          <li>A measured reduction in food waste</li>
        </ul>
        <div className="mt-6">
          <Button asChild>
            <Link href="/student/menu">Open the menu</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

function JourneyScene({ scene }: { scene: "hold" | "play" | "settled" }) {
  const motion = scene === "play" ? "iso-play" : scene === "settled" ? "iso-settled" : "";
  return (
    <div className="iso-viewport w-full" data-testid="food-hero" aria-hidden="true">
      <div className={`iso-world ${motion}`}>
        <svg className="iso-wires" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path className="wire wire-1" d="M22 64 L38 30" />
          <path className="wire wire-2" d="M38 30 L64 70" />
          <path className="wire wire-3" d="M64 70 L80 34" />
          <path className="wire wire-pulse" d="M22 64 L38 30 L64 70 L80 34" />
        </svg>
        <Pod tone="yellow" style={{ left: "22%", top: "64%" }} glyph="plate" />
        <Pod tone="green" style={{ left: "38%", top: "30%" }} glyph="ticket" />
        <Pod tone="blue" style={{ left: "64%", top: "70%" }} glyph="kitchen" />
        <Pod tone="pink" style={{ left: "80%", top: "34%" }} glyph="pickup" />
      </div>
    </div>
  );
}

function Pod({
  tone,
  style,
  glyph,
}: {
  tone: string;
  style: { left: string; top: string };
  glyph: "plate" | "ticket" | "kitchen" | "pickup";
}) {
  return (
    <div className={`pod pod-${tone}`} style={style}>
      <div className="pod-pool" />
      <div className="pod-front" />
      <div className="pod-side" />
      <div className="pod-top">
        <PodGlyph kind={glyph} />
      </div>
    </div>
  );
}

function PodGlyph({ kind }: { kind: "plate" | "ticket" | "kitchen" | "pickup" }) {
  if (kind === "plate") {
    return (
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <ellipse cx="16" cy="18" rx="11" ry="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 17c2-6 14-6 16 0" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "ticket") {
    return (
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <rect x="8" y="6" width="16" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 12h8M12 16h8M12 20h5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  if (kind === "kitchen") {
    return (
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <path d="M10 22V10M14 22V8M18 22c0-8 6-8 6 0" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
      <path d="M8 14h16l-2 10H10z" fill="currentColor" />
      <path d="M12 14V9h8v5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
