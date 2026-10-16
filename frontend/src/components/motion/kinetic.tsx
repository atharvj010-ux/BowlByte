"use client";

import { motion, transform, useInView, useScroll, useTransform, type MotionValue } from "motion/react";
import { useRef, type ReactNode, type Ref } from "react";

import type { FoodArt } from "@/lib/food-art";

type Tag = "h1" | "h2" | "h3" | "p";

/**
 * Splits text into masked characters. "load" uses CSS keyframes so the hero
 * reads at first paint even before hydration. "view" rises when scrolled in.
 */
export function KineticText({
  lines,
  as = "h2",
  mode = "view",
  className = "",
  delay = 0,
  id,
}: {
  lines: string[];
  as?: Tag;
  mode?: "load" | "view";
  className?: string;
  delay?: number;
  id?: string;
}) {
  const Tag = as;
  const ref = useRef<HTMLElement>(null);
  // Observe the heading, not each character: a character starts clipped by its mask and never intersects.
  const inView = useInView(ref, { once: true, amount: 0.35 });
  let index = 0;
  const label = lines.join(" ");
  return (
    <Tag ref={ref as Ref<never>} id={id} aria-label={label} className={`kin-text ${className}`}>
      {lines.map((line, lineIndex) => (
        <span key={`${line}-${lineIndex}`} className="kin-line" aria-hidden="true">
          {line.split(" ").map((word, wordIndex, words) => (
            <span key={`${word}-${wordIndex}`}>
              <span className="kin-word">
                {Array.from(word).map((char, charIndex) => {
                  const order = index++;
                  return mode === "load" ? (
                    <span key={charIndex} className="kin-mask">
                      <span
                        className="kin-ch kin-ch-load"
                        style={{ animationDelay: `${delay + order * 28}ms` }}
                      >
                        {char}
                      </span>
                    </span>
                  ) : (
                    <span key={charIndex} className="kin-mask">
                      <motion.span
                        className="kin-ch"
                        data-kin=""
                        initial={{ y: "108%", rotate: 6 }}
                        animate={inView ? { y: "0%", rotate: 0 } : undefined}
                        transition={{ duration: 0.7, delay: delay / 1000 + order * 0.024, ease: [0.2, 0.8, 0.2, 1] }}
                      >
                        {char}
                      </motion.span>
                    </span>
                  );
                })}
              </span>
              {wordIndex < words.length - 1 ? " " : null}
            </span>
          ))}
          {lineIndex < lines.length - 1 ? " " : null}
        </span>
      ))}
    </Tag>
  );
}

type Shot = { art: FoodArt; className: string; depth: number; front?: boolean };

/**
 * Range mapping for opacity, clip-path, and color. Motion offloads the array
 * form of those to a native ViewTimeline, which ignores the useScroll offset.
 */
function useRange<T extends string | number>(p: MotionValue<number>, input: number[], output: T[]) {
  return useTransform(p, (v) => transform(v, input, output));
}

/**
 * A pinned scene: the first word breaks apart letter by letter while the food
 * underneath changes, then the second word assembles. Scrolling stays native.
 */
export function KineticSwap({
  id,
  from,
  to,
  fromNote,
  toNote,
  fromShots,
  toShots,
  index,
}: {
  id?: string;
  from: string;
  to: string;
  fromNote: ReactNode;
  toNote: ReactNode;
  fromShots: Shot[];
  toShots: Shot[];
  index: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const frameScale = useTransform(p, [0, 0.5, 1], [0.92, 1, 0.96]);
  const fromNoteOpacity = useRange(p, [0.1, 0.3], [1, 0]);
  const toNoteOpacity = useRange(p, [0.7, 0.85], [0, 1]);
  const toNoteY = useTransform(p, [0.7, 0.85], [24, 0]);
  const wash = useRange(p, [0.3, 0.55], ["rgba(92,46,168,0.38)", "rgba(241,84,56,0.22)"]);

  return (
    <section ref={ref} id={id} className="kin-scene" aria-label={`${from} ${to}`}>
      <div className="kin-stage">
        <motion.div className="kin-frame" style={{ scale: frameScale }} data-kin="">
          <motion.div className="kin-wash" style={{ backgroundColor: wash }} data-kin="" />
          {fromShots
            .filter((shot) => !shot.front)
            .map((shot) => (
              <ShotLayer key={shot.art.dish + shot.className} shot={shot} p={p} phase="out" />
            ))}
          {toShots
            .filter((shot) => !shot.front)
            .map((shot) => (
              <ShotLayer key={shot.art.dish + shot.className} shot={shot} p={p} phase="in" />
            ))}
        </motion.div>
        <div className="kin-words">
          <SplitWord text={from} p={p} phase="out" />
          <SplitWord text={to} p={p} phase="in" />
        </div>
        <div className="kin-front">
          {fromShots
            .filter((shot) => shot.front)
            .map((shot) => (
              <ShotLayer key={shot.art.dish + shot.className} shot={shot} p={p} phase="out" />
            ))}
          {toShots
            .filter((shot) => shot.front)
            .map((shot) => (
              <ShotLayer key={shot.art.dish + shot.className} shot={shot} p={p} phase="in" />
            ))}
        </div>
        <div className="kin-caption">
          <span className="kin-index">{index}</span>
          <motion.div className="kin-note kin-note-from" style={{ opacity: fromNoteOpacity }} data-kin="">
            {fromNote}
          </motion.div>
          <motion.div className="kin-note kin-note-to" style={{ opacity: toNoteOpacity, y: toNoteY }} data-kin="">
            {toNote}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function SplitWord({ text, p, phase }: { text: string; p: MotionValue<number>; phase: "out" | "in" }) {
  const chars = Array.from(text);
  const fontSize = `clamp(3rem, calc(92vw / ${(chars.length * 0.62).toFixed(2)}), 15rem)`;
  return (
    <p
      className={`kin-word-big kin-word-${phase}`}
      style={{ fontSize }}
      aria-hidden="true"
    >
      {chars.map((char, i) => (
        <SplitChar key={i} char={char} i={i} n={chars.length} p={p} phase={phase} />
      ))}
    </p>
  );
}

function SplitChar({
  char,
  i,
  n,
  p,
  phase,
}: {
  char: string;
  i: number;
  n: number;
  p: MotionValue<number>;
  phase: "out" | "in";
}) {
  const k = i - (n - 1) / 2;
  const lift = i % 2 === 0 ? 1 : -1;
  const outX = useTransform(p, [0.14, 0.44], ["0vw", `${k * 7}vw`]);
  const outY = useTransform(p, [0.14, 0.44], ["0%", `${lift * 70}%`]);
  const outScale = useTransform(p, [0.14, 0.44], [1, 1.9]);
  const outOpacity = useRange(p, [0.3, 0.46], [1, 0]);
  const inX = useTransform(p, [0.48, 0.78], [`${k * 9}vw`, "0vw"]);
  const inY = useTransform(p, [0.48, 0.74], [`${lift * 110}%`, "0%"]);
  const inRotate = useTransform(p, [0.48, 0.74], [lift * 12, 0]);
  const inOpacity = useRange(p, [0.48, 0.58], [0, 1]);
  const style =
    phase === "out"
      ? { x: outX, y: outY, scale: outScale, opacity: outOpacity }
      : { x: inX, y: inY, rotate: inRotate, opacity: inOpacity };
  return (
    <span className="kin-mask kin-mask-wide">
      <motion.span className="kin-ch" style={style} data-kin="">
        {char === " " ? "\u00a0" : char}
      </motion.span>
    </span>
  );
}

function ShotLayer({ shot, p, phase }: { shot: Shot; p: MotionValue<number>; phase: "out" | "in" }) {
  const drift = useTransform(p, [0, 1], [`${shot.depth * 18}vh`, `${shot.depth * -18}vh`]);
  const outOpacity = useRange(p, [0.28, 0.46], [1, 0]);
  const outScale = useTransform(p, [0, 0.46], [1, 1 + shot.depth * 0.25]);
  const inClip = useRange(p, [0.44, 0.7], ["inset(100% 0% 0% 0%)", "inset(0% 0% 0% 0%)"]);
  const inScale = useTransform(p, [0.44, 0.8], [1.25, 1]);
  const style =
    phase === "out"
      ? { y: drift, opacity: outOpacity, scale: outScale }
      : { y: drift, clipPath: inClip, scale: inScale };
  return (
    <motion.div className={`kin-shot ${shot.className}`} style={style} data-kin="" data-phase={phase}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={shot.art.src} alt="" loading="lazy" decoding="async" />
    </motion.div>
  );
}
