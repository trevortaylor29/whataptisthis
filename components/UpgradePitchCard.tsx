"use client";

import {
  CREDIT_PACK_COLUMN_LEFT,
  CREDIT_PACK_COLUMN_RIGHT,
  CREDIT_PACK_BUTTON,
  CREDIT_PACK_FOOTNOTE,
  CREDIT_PACK_HEADLINE,
} from "@/lib/pricing";

interface Props {
  onPurchase: () => void;
}

export default function UpgradePitchCard({ onPurchase }: Props) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-gradient-to-r from-[rgba(124,58,237,0.08)] to-[rgba(124,58,237,0.12)] p-4 md:p-5">
      <h2 className="font-display text-lg font-semibold tracking-tight text-ink-100 md:text-xl">
        {CREDIT_PACK_HEADLINE}
      </h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2 md:gap-6">
        <ul className="flex flex-col gap-3 text-sm text-ink-300">
          {CREDIT_PACK_COLUMN_LEFT.map((line) => (
            <li key={line} className="flex gap-2">
              <span className="text-emerald-500" aria-hidden>
                ✓
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <ul className="flex flex-col gap-3 text-sm text-ink-300">
          {CREDIT_PACK_COLUMN_RIGHT.map((line) => (
            <li key={line} className="flex gap-2">
              <span className="text-emerald-500" aria-hidden>
                ✓
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={onPurchase}
        className="mt-5 flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-xl bg-[#7C3AED] px-5 py-3.5 text-sm font-bold text-white transition-all duration-150 ease-out hover:-translate-y-px hover:bg-[#9355F6]"
      >
        {CREDIT_PACK_BUTTON}
      </button>
      <p className="mt-3 text-center text-xs text-[#6B7280]">
        {CREDIT_PACK_FOOTNOTE}
      </p>
    </section>
  );
}
