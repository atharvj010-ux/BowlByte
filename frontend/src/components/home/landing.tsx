"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

import { EntranceScene } from "@/components/home/entrance-scene";
import { KineticSwap, KineticText } from "@/components/motion/kinetic";
import { showcase, type FoodArt } from "@/lib/food-art";

const journey: { title: string; body: string; art: FoodArt; tone: string }[] = [
  { title: "Browse", body: "Only dishes the canteen stocked today, at the price it set.", art: showcase.dosa, tone: "#f6d15a" },
  { title: "Add to cart", body: "Your cart lives on this phone. Nothing is held for you yet.", art: showcase.fries, tone: "#f6d15a" },
  { title: "Place order", body: "The server checks stock, reserves your portions, and confirms the price.", art: showcase.burger, tone: "#3df28b" },
  { title: "Kitchen queue", body: "Each portion joins a station queue. The estimate moves with it.", art: showcase.maggi, tone: "#4aa8ff" },
  { title: "Ready", body: "You get a notice. Open a one-time QR when you reach the counter.", art: showcase.coldCoffee, tone: "#ff5c8a" },
  { title: "Pay and collect", body: "Pay cash at the canteen counter. The cashier scans and hands it over.", art: showcase.samosa, tone: "#ff5c8a" },
];

export function LandingExperience() {
  return (
    <main className="cine">
      <section className="hero" aria-label="Good food. Zero queue drama.">
        <p className="eyebrow">BowlByte · Cravings in motion</p>
        <KineticText id="hero-title" as="h1" mode="load" lines={["Good food.", "Zero queue drama."]} className="hero-title" />
        <p className="hero-copy">Order before the rush. Follow your food from kitchen to counter.</p>
        <div className="hero-actions">
          <Link href="/student/menu" className="pill pill-solid">
            Explore menu
          </Link>
          <Link href="#how-it-works" className="pill pill-ghost">
            How it works
          </Link>
        </div>
        <EntranceScene />
      </section>

      <KineticSwap
        id="cravings"
        index="01"
        from="CRAVINGS."
        to="MADE FRESH."
        fromShots={[
          { art: showcase.burger, className: "shot-center", depth: 0.4 },
          { art: showcase.fries, className: "shot-left", depth: 1, front: true },
          { art: showcase.coldCoffee, className: "shot-right", depth: 0.7 },
        ]}
        toShots={[
          { art: showcase.dosa, className: "shot-center", depth: 0.4 },
          { art: showcase.sandwich, className: "shot-left", depth: 0.9, front: true },
          { art: showcase.chai, className: "shot-right", depth: 0.6 },
        ]}
        fromNote={
          <>
            <strong>Burgers, fries, dosa, cold coffee.</strong> Whatever the canteen stocked today.
            <span className="tag">Illustrative images</span>
          </>
        }
        toNote={
          <>
            <strong>Cooked after you order.</strong> Not sitting under a lamp.
          </>
        }
      />

      <MadeFresh />
      <Journey />

      <KineticSwap
        index="02"
        from="THE KITCHEN"
        to="READY TO GO"
        fromShots={[
          { art: showcase.maggi, className: "shot-center", depth: 0.4 },
          { art: showcase.samosa, className: "shot-left", depth: 1, front: true },
          { art: showcase.idli, className: "shot-right", depth: 0.7 },
        ]}
        toShots={[
          { art: showcase.cola, className: "shot-center", depth: 0.4 },
          { art: showcase.burger, className: "shot-left", depth: 0.9, front: true },
          { art: showcase.fries, className: "shot-right", depth: 0.6 },
        ]}
        fromNote={
          <>
            <strong>Stations, not guesswork.</strong> Each one has a capacity the kitchen set.
          </>
        }
        toNote={
          <>
            <strong>Ready means packed.</strong> Staff confirm it before you are told.
          </>
        }
      />

      <PayPickup />
      <Intelligence />

      <section className="limits" aria-labelledby="limits-title">
        <h2 id="limits-title" className="section-kicker-title">
          Not in this release
        </h2>
        <ul>
          <li>Online payments of any kind</li>
          <li>A public HTTPS site and observed phone notifications</li>
          <li>A measured reduction in food waste</li>
        </ul>
      </section>

      <section className="final-cta" aria-label="Skip the queue. Keep the food.">
        <KineticText id="final-title" lines={["Skip the queue.", "Keep the food."]} className="mega-title" />
        <div className="hero-actions">
          <Link href="/student/menu" className="pill pill-solid">
            Open the menu
          </Link>
          <Link href="/student/register" className="pill pill-ghost">
            Create a student account
          </Link>
        </div>
      </section>
    </main>
  );
}

function MadeFresh() {
  const lanes = [
    { station: "Dosa station", tone: "#f6d15a", tickets: ["Masala dosa", "Idli"] },
    { station: "Grill", tone: "#3df28b", tickets: ["Veg burger", "Sandwich", "Fries"] },
    { station: "Drinks", tone: "#4aa8ff", tickets: ["Cold coffee"] },
  ];
  return (
    <section className="fresh" aria-labelledby="fresh-title">
      <div className="fresh-copy">
        <p className="eyebrow">The preparation queue</p>
        <h2 id="fresh-title" className="section-title">
          A real queue.
          <br />A live estimate.
        </h2>
        <p>
          Every portion joins a station queue with the capacity the kitchen set. Staff accept, start, and complete each
          task. Your ready time is recalculated from that queue and always shown as an estimate.
        </p>
        <p className="fine">If a station closes, the estimate is withdrawn instead of guessed.</p>
      </div>
      <div className="fresh-board" aria-hidden="true">
        <p className="board-tag">Illustration · not live data</p>
        {lanes.map((lane, laneIndex) => (
          <div key={lane.station} className="lane" style={{ ["--tone" as string]: lane.tone }}>
            <span className="lane-name">{lane.station}</span>
            <div className="lane-track">
              {lane.tickets.map((ticket, index) => (
                <motion.span
                  key={ticket}
                  className="lane-chip"
                  initial={{ x: "120%", opacity: 0 }}
                  whileInView={{ x: "0%", opacity: 1 }}
                  viewport={{ once: true, amount: 0.6 }}
                  transition={{ delay: laneIndex * 0.18 + index * 0.12, duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  {ticket}
                  {index === 0 ? <i className="lane-live" /> : null}
                </motion.span>
              ))}
            </div>
          </div>
        ))}
        <div className="eta-chip">
          <span>Estimated ready</span>
          <strong>~ 12 min</strong>
        </div>
      </div>
    </section>
  );
}

function Journey() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const x = useTransform(scrollYProgress, [0.05, 0.95], ["0%", "-60%"]);
  const bar = useTransform(scrollYProgress, [0.05, 0.95], ["0%", "100%"]);
  return (
    <section ref={ref} id="how-it-works" className="journey" aria-label="From craving to counter.">
      <div className="journey-stage">
        <div className="journey-head">
          <KineticText id="journey-title" lines={["From craving", "to counter."]} className="section-title" />
          <div className="journey-bar" aria-hidden="true">
            <motion.span style={{ width: bar }} data-kin="" />
          </div>
        </div>
        <motion.ol className="journey-track" style={{ x }} data-kin="">
          {journey.map((step, index) => (
            <li key={step.title} className="journey-card" style={{ ["--tone" as string]: step.tone }}>
              <span className="journey-num" aria-hidden="true">
                0{index + 1}
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={step.art.small} alt="" loading="lazy" decoding="async" className="journey-art" />
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </motion.ol>
      </div>
    </section>
  );
}

function PayPickup() {
  return (
    <section className="pay" aria-label="Ready. Pay. Pick up.">
      <div className="pay-copy">
        <KineticText id="pay-title" lines={["Ready.", "Pay.", "Pick up."]} className="mega-title" />
        <h3 className="pay-sub">Cash at the counter</h3>
        <p>
          Pay cash at the canteen counter when your food is ready. The cashier records it, then your QR works once and
          expires quickly. Nothing is charged online.
        </p>
        <ul className="pay-points">
          <li>Cash only</li>
          <li>One-time QR</li>
          <li>Ticket number backup</li>
        </ul>
      </div>
      <motion.div
        className="pass"
        aria-hidden="true"
        initial={{ rotate: -8, y: 60, opacity: 0 }}
        whileInView={{ rotate: -3, y: 0, opacity: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ type: "spring", stiffness: 90, damping: 16 }}
      >
        <div className="pass-head">
          <span>BowlByte</span>
          <span>Example pass</span>
        </div>
        <PatternQr />
        <div className="pass-foot">
          <span>READY</span>
          <span>CASH · PAY AT COUNTER</span>
        </div>
      </motion.div>
    </section>
  );
}

function PatternQr() {
  // A decorative pattern, deliberately not an encoded QR code.
  const cells: [number, number][] = [];
  let seed = 7;
  for (let y = 0; y < 21; y += 1) {
    for (let x = 0; x < 21; x += 1) {
      seed = (seed * 9301 + 49297) % 233280;
      const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      if (!finder && seed / 233280 > 0.55) {
        cells.push([x, y]);
      }
    }
  }
  return (
    <svg viewBox="0 0 21 21" className="pass-qr">
      {[
        [0, 0],
        [14, 0],
        [0, 14],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x + 0.5} y={y + 0.5} width="6" height="6" fill="none" stroke="currentColor" />
          <rect x={x + 2} y={y + 2} width="3" height="3" fill="currentColor" />
        </g>
      ))}
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" />
      ))}
    </svg>
  );
}

function Intelligence() {
  const panels = [
    {
      title: "Forecasting",
      body: "Demand forecasts are drafts. A manager reviews and approves one before it shapes anything.",
      bars: [32, 48, 40, 66, 58, 74, 52],
    },
    {
      title: "Planning",
      body: "An approved forecast becomes a preparation plan: portions per dish, per station.",
      bars: [60, 60, 44, 44, 70, 70, 36],
    },
    {
      title: "Waste tracking",
      body: "Staff record what was made and what was thrown away. We report the record, not a saving.",
      bars: [20, 14, 26, 12, 18, 22, 16],
    },
  ];
  return (
    <section className="intel" aria-label="BowlByte intelligence.">
      <KineticText id="intel-title" lines={["BowlByte", "intelligence."]} className="section-title" />
      <p className="intel-lede">
        Tools for the canteen manager. Forecasts trained on synthetic demo data are labeled as demo, and no measured drop
        in food waste is claimed.
      </p>
      <div className="intel-grid">
        {panels.map((panel, index) => (
          <motion.article
            key={panel.title}
            className="intel-panel"
            initial={{ y: 40, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ delay: index * 0.1, duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="intel-bars" aria-hidden="true">
              {panel.bars.map((height, barIndex) => (
                <span key={barIndex} style={{ height: `${height}%` }} />
              ))}
            </div>
            <h3>{panel.title}</h3>
            <p>{panel.body}</p>
          </motion.article>
        ))}
      </div>
      <p className="fine">Bars are illustrations of each screen, not results.</p>
    </section>
  );
}
