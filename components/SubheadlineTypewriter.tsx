"use client";

import { useEffect, useState } from "react";

const PHRASES = [
  "Stop DMing agents for the apartment name.",
  "Stop filling out forms just to see a floor plan.",
  "Stop begging for the building link.",
] as const;

const TYPE_MS = 34;
const ERASE_MS = 20;
const PAUSE_MS = 2000;

/**
 * Cycles subheadlines: type → pause 2s → erase → next phrase (loop).
 */
export default function SubheadlineTypewriter() {
  const [text, setText] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
    let phraseIdx = 0;
    let len = 0;
    type Phase = "type" | "pause" | "erase";
    let phase: Phase = "type";

    function phrase() {
      return PHRASES[phraseIdx % PHRASES.length]!;
    }

    function schedule(ms: number, fn: () => void) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
    }

    function tick() {
      if (cancelled) return;
      const p = phrase();

      if (phase === "type") {
        if (len < p.length) {
          len += 1;
          setText(p.slice(0, len));
          schedule(TYPE_MS, tick);
        } else {
          phase = "pause";
          schedule(PAUSE_MS, () => {
            if (cancelled) return;
            phase = "erase";
            tick();
          });
        }
      } else if (phase === "erase") {
        if (len > 0) {
          len -= 1;
          setText(p.slice(0, len));
          schedule(ERASE_MS, tick);
        } else {
          phraseIdx += 1;
          phase = "type";
          schedule(TYPE_MS, tick);
        }
      }
    }

    schedule(TYPE_MS, tick);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <p
      className="mb-10 min-h-[4.25rem] max-w-xl text-lg font-normal leading-relaxed text-ink-400 md:text-xl"
      aria-live="polite"
    >
      {text}
      <span
        className="ml-0.5 inline-block h-[1.05em] w-px animate-pulse bg-accent/75 align-middle opacity-90"
        aria-hidden
      />
    </p>
  );
}
