"use client";

import { useEffect, useState } from "react";

const STEPS = [
  "Extracting video clues",
  "Reading visible text and landmarks",
  "Searching apartment listings",
  "Analyzing candidates",
  "Building results",
];

const STEP_DELAYS_MS = [0, 2500, 6500, 13000, 19000];

interface Props {
  finishing?: boolean;
}

export default function ProcessingView({ finishing = false }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (finishing) return;
    const timers = STEP_DELAYS_MS.slice(1).map((delay, i) =>
      setTimeout(() => setActiveIndex(i + 1), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [finishing]);

  useEffect(() => {
    if (!finishing) return;
    const id = setInterval(() => {
      setActiveIndex((i) => Math.min(i + 1, STEPS.length));
    }, 120);
    return () => clearInterval(id);
  }, [finishing]);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800 px-5 py-7 md:px-8 md:py-9">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="font-display text-lg font-semibold text-ink-100">
          Finding this apartment
        </h2>
        <span className="font-mono text-xs text-ink-500">
          {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
          {String(elapsed % 60).padStart(2, "0")}
        </span>
      </div>

      <ol className="flex flex-col gap-3">
        {STEPS.map((label, i) => {
          const status =
            i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
          return (
            <li
              key={label}
              className="flex items-center gap-3"
              aria-current={status === "active" ? "step" : undefined}
            >
              <StepIcon status={status} />
              <span
                className={
                  status === "done"
                    ? "text-ink-500 line-through decoration-ink-600"
                    : status === "active"
                      ? "font-medium text-ink-100"
                      : "text-ink-500"
                }
              >
                {label}
                {status === "active" && <AnimatedEllipsis />}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-6 text-xs text-ink-500">
        This usually takes 10–30 seconds.
      </p>
    </div>
  );
}

function StepIcon({ status }: { status: "done" | "active" | "pending" }) {
  if (status === "done") {
    return (
      <span
        aria-hidden
        className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M2.5 6.5L5 9L9.5 3.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "active") {
    return (
      <span
        aria-hidden
        className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-accent/50 bg-ink-900"
      >
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-ink-700 bg-ink-900"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-ink-600" />
    </span>
  );
}

function AnimatedEllipsis() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v + 1) % 4), 400);
    return () => clearInterval(id);
  }, []);
  return (
    <span aria-hidden className="text-ink-500">
      {".".repeat(n)}
    </span>
  );
}
