"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { DishMark } from "@/components/menu/food-mark";
import { Button } from "@/components/ui/button";

const steps = [
  ["Order ahead", "Pick what is actually in stock. The price is confirmed when you place the order."],
  ["Kitchen queue", "The counter sees a ticket, a station, and an estimate. It is a queue, not a guess."],
  ["Cash and QR", "Pay when you collect. The pickup code works once."],
];

export function LandingExperience() {
  const [welcome, setWelcome] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seen = window.sessionStorage.getItem("bowlbyte.welcome");
    if (reduce || seen) {
      return;
    }
    const show = window.setTimeout(() => setWelcome(true), 0);
    const timer = window.setTimeout(() => {
      window.sessionStorage.setItem("bowlbyte.welcome", "1");
      setWelcome(false);
    }, 1400);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(timer);
    };
  }, []);

  function skipWelcome() {
    window.sessionStorage.setItem("bowlbyte.welcome", "1");
    setWelcome(false);
  }

  return (
    <main className="overflow-x-clip">
      {welcome ? (
        <div className="welcome-screen" data-testid="welcome">
          <div className="text-center">
            <p className="font-display text-5xl">BowlByte</p>
            <p className="mt-2 text-lime">Food in motion</p>
            <button type="button" className="mt-6 min-h-11 underline" onClick={skipWelcome}>
              Skip
            </button>
          </div>
        </div>
      ) : null}

      <section className="mx-auto grid w-full max-w-6xl items-center gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-12">
        <div className="order-2 space-y-6 lg:order-1">
          <p className="text-xs font-medium tracking-[0.22em] text-chili uppercase">College canteen</p>
          <h1 className="font-display text-5xl leading-[0.9] tracking-tight sm:text-7xl">
            Good food.
            <br />
            Zero queue drama.
          </h1>
          <p className="max-w-xl text-lg leading-8">
            Order before you reach the counter. The kitchen works the ticket. You pay cash when the food is ready.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild>
              <Link href="/student/menu">Explore menu</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="#how-it-works">How it works</Link>
            </Button>
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <FoodHero />
        </div>
      </section>

      <section id="how-it-works" className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <h2 className="font-display text-4xl tracking-tight">How BowlByte works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map(([title, body], index) => (
            <li key={title} className="rounded-[1.5rem] bg-ink p-5 text-ivory">
              <p className="text-lime">0{index + 1}</p>
              <h3 className="mt-3 font-display text-3xl">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-ivory/80">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8 sm:px-6" aria-labelledby="food-rail">
        <h2 id="food-rail" className="font-display text-4xl tracking-tight">
          Explore the counter
        </h2>
        <div className="story-rail">
          {(
            [
              ["Dosa", "dosa"],
              ["Sandwich", "sandwich"],
              ["Fries", "fries"],
              ["Cold coffee", "drink"],
            ] as const
          ).map(([name, kind]) => (
            <article key={name} className="rounded-[1.5rem] border border-border bg-card p-4">
              <DishMark kind={kind} />
              <h3 className="mt-3 font-display text-2xl">{name}</h3>
              <p className="text-sm text-muted-foreground">Shown when the canteen publishes it. Prices stay on the menu.</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-8 sm:px-6 lg:grid-cols-2">
        <article className="rounded-[1.5rem] bg-card p-6">
          <h2 className="font-display text-4xl">Smart kitchen and ETA</h2>
          <p className="mt-3 leading-7">
            Each portion sits on a station with a capacity. The ready time is an estimate written with the kitchen update, not a promise.
          </p>
        </article>
        <article className="rounded-[1.5rem] bg-lime p-6 text-ink">
          <h2 className="font-display text-4xl">Cash at the counter</h2>
          <p className="mt-3 leading-7">
            Payment starts pending. A cashier records the notes, then the QR works once. There is no online payment.
          </p>
        </article>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <h2 className="font-display text-4xl">BowlByte intelligence</h2>
        <p className="mt-3 max-w-2xl leading-7">
          Managers can record production, waste, and a forecast they must approve. Demo scores are labeled as demo. They are not a measured drop in waste.
        </p>
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
            <Link href="/student">Open the student area</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

function FoodHero() {
  return (
    <div
      className="relative mx-auto aspect-square w-48 sm:w-72 lg:w-full lg:max-w-md"
      aria-hidden="true"
      data-testid="food-hero"
    >
      <svg viewBox="0 0 320 320" className="hero-layer hero-layer-1">
        <ellipse cx="160" cy="228" rx="108" ry="18" fill="#191919" opacity="0.16" />
        <ellipse cx="160" cy="176" rx="118" ry="78" fill="#fff8ec" stroke="#191919" strokeWidth="6" />
        <ellipse cx="160" cy="176" rx="96" ry="60" fill="none" stroke="#e2d3ba" strokeWidth="3" />
      </svg>
      <svg viewBox="0 0 320 320" className="hero-layer hero-layer-2">
        <path
          d="M78 188c8-62 36-92 82-92s74 30 82 92c-28 16-136 16-164 0z"
          fill="#c9842a"
        />
        <path d="M96 176c18-28 110-34 136-6" fill="none" stroke="#f4eddd" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <svg viewBox="0 0 320 320" className="hero-layer hero-layer-3">
        <path d="M118 168c10-22 74-24 92 2-22 8-70 8-92-2z" fill="#f15438" />
        <path d="M108 186c16 10 78 12 104-2 4 14-18 28-52 28s-56-12-52-26z" fill="#d5f25b" />
      </svg>
      <svg viewBox="0 0 320 320" className="hero-layer hero-layer-4">
        <circle cx="132" cy="154" r="6" fill="#191919" />
        <circle cx="168" cy="148" r="5" fill="#191919" />
        <circle cx="196" cy="160" r="4" fill="#191919" />
        <circle cx="150" cy="172" r="3.5" fill="#fff8ec" />
      </svg>
    </div>
  );
}

