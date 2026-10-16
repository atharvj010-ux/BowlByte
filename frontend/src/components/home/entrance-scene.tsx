"use client";

import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";

// Module scope survives client navigation and resets on a full page load,
// which is exactly when the entrance should replay.
let entrancePlayed = false;

const U = 40;

type Point = [number, number, number?];

function at(gx: number, gy: number, z = 0): [number, number] {
  return [Number(((gx - gy) * 0.866 * U).toFixed(1)), Number(((gx + gy) * 0.5 * U - z * U).toFixed(1))];
}

function polygon(points: Point[]) {
  return `M${points.map(([x, y, z]) => at(x, y, z).join(" ")).join(" L")}Z`;
}

function route(points: [number, number][]) {
  return `M${points.map(([x, y]) => at(x, y).join(" ")).join(" L")}`;
}

function box(cx: number, cy: number, h: number, z0: number, z1: number) {
  return {
    top: polygon([
      [cx - h, cy - h, z1],
      [cx + h, cy - h, z1],
      [cx + h, cy + h, z1],
      [cx - h, cy + h, z1],
    ]),
    right: polygon([
      [cx + h, cy - h, z0],
      [cx + h, cy + h, z0],
      [cx + h, cy + h, z1],
      [cx + h, cy - h, z1],
    ]),
    left: polygon([
      [cx - h, cy + h, z0],
      [cx + h, cy + h, z0],
      [cx + h, cy + h, z1],
      [cx - h, cy + h, z1],
    ]),
  };
}

type Glyph = "discover" | "order" | "kitchen" | "pickup";

const modules = [
  { key: "discover", label: "Discover food", tone: "#f6d15a", gx: 4.5, gy: 10.5, litAt: 2 },
  { key: "order", label: "Place order", tone: "#3df28b", gx: 3, gy: 5, litAt: 4 },
  { key: "kitchen", label: "Kitchen preparation", tone: "#4aa8ff", gx: 9, gy: 7, litAt: 6 },
  { key: "pickup", label: "Ready for pickup", tone: "#ff5c8a", gx: 7.5, gy: 1.5, litAt: 8 },
] as const satisfies readonly { key: Glyph; label: string; tone: string; gx: number; gy: number; litAt: number }[];

const traces = [
  { d: route([[4.5, 15.5], [4.5, 10.5]]), tone: "#f6d15a", drawAt: 1 },
  { d: route([[4.5, 10.5], [4.5, 7.5], [3, 7.5], [3, 5]]), tone: "#f6d15a", drawAt: 3 },
  { d: route([[3, 5], [6, 5], [6, 7], [9, 7]]), tone: "#3df28b", drawAt: 5 },
  { d: route([[9, 7], [9, 4], [7.5, 4], [7.5, 1.5]]), tone: "#4aa8ff", drawAt: 7 },
  { d: route([[7.5, 1.5], [14, 1.5]]), tone: "#ff5c8a", drawAt: 9 },
];

const network = route([
  [4.5, 15.5],
  [4.5, 7.5],
  [3, 7.5],
  [3, 5],
  [6, 5],
  [6, 7],
  [9, 7],
  [9, 4],
  [7.5, 4],
  [7.5, 1.5],
  [14, 1.5],
]);

// Stage n begins at timeline[n] ms. Odd stages draw a path, even stages light a module.
const timeline = [0, 200, 700, 1150, 1750, 2200, 2800, 3250, 3850, 4300, 4700, 5900];
const FINAL = timeline.length - 1;
const PULSE = 10;

const drawOrder = [...modules].sort((a, b) => a.gx + a.gy - (b.gx + b.gy));

export function EntranceScene() {
  const [stage, setStage] = useState(0);
  const [instant, setInstant] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18 });
  const sy = useSpring(py, { stiffness: 60, damping: 18 });
  const floorX = useTransform(sx, (v) => v * -6);
  const floorY = useTransform(sy, (v) => v * -4);
  const liftX = useTransform(sx, (v) => v * -14);
  const liftY = useTransform(sy, (v) => v * -9);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || entrancePlayed) {
      const settle = window.setTimeout(() => {
        setInstant(true);
        setStage(FINAL);
      }, 0);
      return () => window.clearTimeout(settle);
    }
    const timers = timeline.slice(1).map((ms, index) =>
      window.setTimeout(() => {
        setStage(index + 1);
        if (index + 1 === FINAL) {
          entrancePlayed = true;
        }
      }, ms),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    const node = host.current;
    if (!node || !window.matchMedia("(pointer: fine)").matches) {
      return;
    }
    const move = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      px.set(((event.clientX - rect.left) / rect.width - 0.5) * 2);
      py.set(((event.clientY - rect.top) / rect.height - 0.5) * 2);
    };
    const leave = () => {
      px.set(0);
      py.set(0);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerleave", leave);
    return () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", leave);
    };
  }, [px, py]);

  function skip() {
    entrancePlayed = true;
    setInstant(true);
    setStage(FINAL);
  }

  const playing = stage < FINAL && !instant;
  const speed = instant ? 0 : 1;

  return (
    <div ref={host} className="iso-host" data-testid="food-hero" data-stage={stage === FINAL ? "settled" : "playing"}>
      {playing ? (
        <div className="iso-skip" data-testid="entrance">
          <span className="iso-skip-label">Lights on</span>
          <button type="button" onClick={skip}>
            Skip
          </button>
        </div>
      ) : null}
      <svg
        className="iso-svg"
        viewBox="-304 64 608 368"
        role="img"
        aria-label="Four stations light up in order: discover food, place order, kitchen preparation, ready for pickup."
      >
        <defs>
          <radialGradient id="iso-floor-fade">
            <stop offset="0.35" stopColor="#fff" />
            <stop offset="1" stopColor="#000" />
          </radialGradient>
          <mask id="iso-floor-mask">
            <rect x="-304" y="64" width="608" height="368" fill="url(#iso-floor-fade)" />
          </mask>
          <radialGradient id="iso-shadow">
            <stop offset="0" stopColor="#000" stopOpacity="0.85" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          {modules.map((m) => (
            <radialGradient key={m.key} id={`iso-pool-${m.key}`}>
              <stop offset="0" stopColor={m.tone} stopOpacity="0.55" />
              <stop offset="0.45" stopColor={m.tone} stopOpacity="0.18" />
              <stop offset="1" stopColor={m.tone} stopOpacity="0" />
            </radialGradient>
          ))}
          {modules.map((m) => (
            <linearGradient key={m.key} id={`iso-face-${m.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={m.tone} stopOpacity="0.55" />
              <stop offset="1" stopColor={m.tone} stopOpacity="0.04" />
            </linearGradient>
          ))}
        </defs>

        <motion.g
          initial={{ scale: 1.1, y: 18 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ duration: 5.6 * speed, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.g style={{ x: floorX, y: floorY }}>
            <Floor />
            {modules.map((m) => {
              const [cx, cy] = at(m.gx + 0.35, m.gy + 0.35);
              return <ellipse key={m.key} cx={cx} cy={cy} rx={U * 2.3} ry={U * 1.15} fill="url(#iso-shadow)" />;
            })}
            {modules.map((m) => {
              const [cx, cy] = at(m.gx, m.gy);
              return (
                <motion.ellipse
                  key={m.key}
                  className="iso-pool"
                  cx={cx}
                  cy={cy}
                  rx={U * 3.6}
                  ry={U * 1.8}
                  fill={`url(#iso-pool-${m.key})`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: stage >= m.litAt ? 1 : 0 }}
                  transition={{ duration: 0.6 * speed }}
                />
              );
            })}
            {traces.map((t) => (
              <g key={t.d}>
                <path d={t.d} className="iso-trace-dim" />
                <motion.path
                  d={t.d}
                  stroke={t.tone}
                  className="iso-trace-glow"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: stage >= t.drawAt ? 1 : 0 }}
                  transition={{ duration: 0.5 * speed, ease: "easeInOut" }}
                />
                <motion.path
                  d={t.d}
                  stroke={t.tone}
                  className="iso-trace-core"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: stage >= t.drawAt ? 1 : 0 }}
                  transition={{ duration: 0.5 * speed, ease: "easeInOut" }}
                />
              </g>
            ))}
            {stage >= PULSE ? <path d={network} pathLength={1} className="iso-pulse" /> : null}
            {modules.map((m) => (
              <FloorLabel key={m.key} m={m} lit={stage >= m.litAt} speed={speed} />
            ))}
          </motion.g>

          <motion.g style={{ x: liftX, y: liftY }}>
            {drawOrder.map((m) => (
              <Module key={m.key} m={m} lit={stage >= m.litAt} speed={speed} />
            ))}
          </motion.g>
        </motion.g>
      </svg>
      <ol className="iso-legend">
        {modules.map((m, index) => (
          <li key={m.key} style={{ color: stage >= m.litAt ? m.tone : undefined }}>
            <span>0{index + 1}</span> {m.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Floor() {
  const lines: string[] = [];
  for (let i = -6; i <= 20; i += 1) {
    lines.push(route([[i, -6], [i, 20]]));
    lines.push(route([[-6, i], [20, i]]));
  }
  return (
    <g mask="url(#iso-floor-mask)">
      {lines.map((d) => (
        <path key={d} d={d} className="iso-grid" />
      ))}
    </g>
  );
}

type ModuleSpec = (typeof modules)[number];

function Module({ m, lit, speed }: { m: ModuleSpec; lit: boolean; speed: number }) {
  const base = box(m.gx, m.gy, 1.15, 0, 0.3);
  const top = box(m.gx, m.gy, 0.82, 0.3, 0.64);
  const [hx, hy] = at(m.gx, m.gy, 0.64);
  const fade = { duration: 0.45 * speed };
  return (
    <g>
      <path d={base.left} fill="#121017" />
      <path d={base.right} fill="#0b0a0f" />
      <path d={base.top} fill="#18161e" className="iso-edge" />
      <motion.path d={base.left} fill={`url(#iso-face-${m.key})`} initial={{ opacity: 0 }} animate={{ opacity: lit ? 0.75 : 0 }} transition={fade} />
      <motion.path d={base.right} fill={`url(#iso-face-${m.key})`} initial={{ opacity: 0 }} animate={{ opacity: lit ? 0.45 : 0 }} transition={fade} />
      <path d={top.left} fill="#15131b" />
      <path d={top.right} fill="#0e0d12" />
      <path d={top.top} fill="#1f1c26" className="iso-edge" />
      <motion.path
        d={top.top}
        fill={m.tone}
        initial={{ opacity: 0 }}
        animate={{ opacity: lit ? [0, 0.95, 0.72] : 0 }}
        transition={{ duration: 0.6 * speed, times: [0, 0.4, 1] }}
      />
      <motion.path
        d={top.top}
        fill="none"
        stroke={m.tone}
        strokeWidth={1.2}
        initial={{ opacity: 0 }}
        animate={{ opacity: lit ? 1 : 0 }}
        transition={fade}
      />
      <motion.ellipse
        cx={hx}
        cy={hy}
        rx={U * 1.8}
        ry={U * 1}
        fill={`url(#iso-pool-${m.key})`}
        initial={{ opacity: 0 }}
        animate={{ opacity: lit ? 0.9 : 0 }}
        transition={fade}
      />
      <g
        transform={`matrix(${0.866 * U * 0.42} ${0.5 * U * 0.42} ${-0.866 * U * 0.42} ${0.5 * U * 0.42} ${hx} ${hy})`}
        className={lit ? "iso-glyph iso-glyph-lit" : "iso-glyph"}
      >
        <ModuleGlyph kind={m.key} />
      </g>
    </g>
  );
}

function ModuleGlyph({ kind }: { kind: Glyph }) {
  const common = { fill: "none", vectorEffect: "non-scaling-stroke" as const };
  if (kind === "discover") {
    return (
      <g {...common}>
        <circle cx="0" cy="0" r="1" />
        <circle cx="0" cy="0" r="0.62" />
        <circle cx="-0.2" cy="-0.15" r="0.12" className="iso-glyph-fill" />
        <circle cx="0.22" cy="0.12" r="0.1" className="iso-glyph-fill" />
      </g>
    );
  }
  if (kind === "order") {
    return (
      <g {...common}>
        <path d="M-0.7 -1 H0.7 V1 L0.35 0.8 L0 1 L-0.35 0.8 L-0.7 1 Z" />
        <path d="M-0.4 -0.5 H0.4 M-0.4 -0.1 H0.4 M-0.4 0.3 H0.15" />
      </g>
    );
  }
  if (kind === "kitchen") {
    return (
      <g {...common}>
        <circle cx="-0.15" cy="0" r="0.75" />
        <path d="M0.6 0 H1.25" />
        <path d="M-0.4 -0.2 Q-0.15 -0.5 0.1 -0.2" />
      </g>
    );
  }
  return (
    <g {...common}>
      <rect x="-1" y="-1" width="0.7" height="0.7" />
      <rect x="0.3" y="-1" width="0.7" height="0.7" />
      <rect x="-1" y="0.3" width="0.7" height="0.7" />
      <rect x="0.4" y="0.4" width="0.25" height="0.25" className="iso-glyph-fill" />
      <rect x="0.75" y="0.75" width="0.25" height="0.25" className="iso-glyph-fill" />
    </g>
  );
}

function FloorLabel({ m, lit, speed }: { m: ModuleSpec; lit: boolean; speed: number }) {
  const [x, y] = at(m.gx - 1.2, m.gy + 1.75);
  return (
    <motion.text
      className="iso-label"
      transform={`matrix(0.866 0.5 -0.866 0.5 ${x} ${y})`}
      initial={{ opacity: 0.28 }}
      animate={{ opacity: lit ? 1 : 0.28, fill: lit ? m.tone : "#f4eddd" }}
      transition={{ duration: 0.45 * speed }}
    >
      {m.label.toUpperCase()}
    </motion.text>
  );
}
