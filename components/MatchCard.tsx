"use client";

import { useState } from "react";
import type {
  ApartmentMatch,
  ConfidencePenaltyBucket,
  VisualVerification,
} from "@/lib/types";
import { shortenToSentences } from "@/lib/format-reasoning";
import { verificationConfidenceAdjustment } from "@/lib/visual-verification-score";
import ConfidenceBadge from "./ConfidenceBadge";

export type MatchTier = "free" | "paid";

const PRO_LOCK_FILLERS = [
  "In-unit laundry and smart-home thermostat package on select floors.",
  "Rooftop lounge with skyline views reserved for residents.",
];

const CON_LOCK_FILLERS = [
  "Premium parking garage fees typical for the submarket.",
  "Move-in specials change frequently vs. tour-era promo pricing.",
];

interface Props {
  match: ApartmentMatch;
  rank: number;
  variant: "top" | "runner";
  tier: MatchTier;
  cityLabel: string;
  scanTier: "lite" | "full";
  onUnlock?: () => void;
}

function LockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M4 7V5a4 4 0 118 0v2M3 7h10v7a1 1 0 01-1 1H4a1 1 0 01-1-1V7z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MatchCard({
  match,
  rank,
  variant,
  tier,
  cityLabel,
  scanTier,
  onUnlock,
}: Props) {
  const isTop = variant === "top";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const v = match.visual_verification;
  const hasEvidence =
    (match.evidence_for?.length ?? 0) +
      (match.evidence_against?.length ?? 0) +
      (v?.matchedFeatures?.length ?? 0) +
      (v?.mismatchedFeatures?.length ?? 0) +
      (v?.reasoning ? 1 : 0) >
    0;

  const summaryText = match.reasoning
    ? tier === "free" && isTop
      ? shortenToSentences(match.reasoning, 2)
      : isTop
        ? shortenToSentences(match.reasoning, 2)
        : shortenToSentences(match.reasoning, 1)
    : "";

  if (tier === "free" && variant === "runner") {
    return (
      <article className="relative overflow-hidden rounded-xl border border-white/[0.14] bg-[#111118] p-3.5 md:p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-500">
              #{rank} · Runner-up
            </p>
            <h3 className="mt-1 font-display text-[15px] font-bold leading-snug text-white md:text-base">
              ???
            </h3>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <ConfidenceBadge confidence={match.confidence} size="sm" />
            <span className="rounded border border-white/[0.06] bg-ink-900/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">
              Unlock
            </span>
          </div>
        </div>

        <div className="relative mt-3 space-y-2.5 rounded-lg border border-white/[0.06] bg-black/20 p-2.5">
          <div className="pointer-events-none select-none blur-md" aria-hidden>
            <p className="text-[13px] text-ink-500">{cityLabel}</p>
          </div>
          <div className="pointer-events-none select-none blur-md" aria-hidden>
            <p className="text-[13px] leading-relaxed text-ink-400">
              {match.reasoning ||
                "Reasoning, street address, and listing deep-links unlock with full results."}
            </p>
          </div>
          <div className="pointer-events-none flex gap-2 blur-md" aria-hidden>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#10B981]/80" />
            <span className="text-[11px] text-ink-500">
              Evidence bullets and cross-checks hidden.
            </span>
          </div>
          <button
            type="button"
            onClick={onUnlock}
            className="relative z-[1] w-full cursor-pointer rounded-md border border-[rgba(124,58,237,0.35)] bg-ink-900/60 py-2 text-[11px] font-medium text-accent-muted transition-all duration-150 ease-out hover:border-[rgba(124,58,237,0.55)] hover:text-ink-100 hover:shadow-[0_0_12px_rgba(124,58,237,0.2)]"
          >
            Unlock full results
          </button>
        </div>
      </article>
    );
  }

  const shellBorder = isTop
    ? "border border-white/[0.06]"
    : "border border-white/[0.14]";
  const shellBg = isTop
    ? "bg-[#151525] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
    : "bg-[#111118] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
  const leftAccent =
    tier === "free" && isTop ? "border-l-[3px] border-l-[#8B5CF6]" : "";

  return (
    <article
      className={`overflow-hidden rounded-xl ${shellBorder} ${shellBg} ${leftAccent}`}
    >
      <header
        className={
          isTop ? "p-5 text-[15px] text-ink-200/90" : "p-4 md:p-5 text-[15px] text-ink-200/90"
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            {isTop ? (
              <h2 className="font-display text-xl font-bold tracking-[-0.02em] text-ink-100 md:text-2xl">
                {match.name || "(unnamed candidate)"}
                {tier === "free" && (
                  <>
                    {" "}
                    <span className="text-[15px] font-normal text-ink-400 md:text-base">
                      · {cityLabel}
                    </span>
                  </>
                )}
              </h2>
            ) : (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-500">
                  #{rank}
                </p>
                <h3 className="mt-1 font-display text-[15px] font-bold text-white md:text-base">
                  {match.name || "(unnamed candidate)"}
                </h3>
              </>
            )}
            {tier === "paid" && match.address && (
              <p
                className={`mt-1.5 text-ink-400 ${isTop ? "text-sm" : "text-sm"}`}
              >
                {match.address}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <ConfidenceBadge
              confidence={match.confidence}
              size={isTop ? "lg" : "md"}
            />
            {tier === "paid" && v && <SingleVisualBadge status={v.status} />}
          </div>
        </div>

        {summaryText && (
          <p
            className={`mt-2 leading-snug text-[#B0B0C0] ${isTop ? "text-sm md:text-[15px]" : "text-sm"}`}
          >
            {summaryText}
          </p>
        )}

        {tier === "paid" && (
          <PaidProsCons
            pros={match.pros}
            cons={match.cons}
            compact={!isTop}
            topClassName={summaryText ? "mt-4" : "mt-2"}
          />
        )}

        {tier === "free" && isTop && (
          <>
            <FreeEvidenceTeaser match={match} />
            <FreeProsConsTeaser
              topClassName={
                (match.evidence_for?.length ?? 0) > 0 ? "mt-3" : "mt-4"
              }
            />
            <div className="mt-4">
              <button
                type="button"
                disabled
                className="flex min-h-[44px] w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-ink-500 bg-ink-900/30 px-5 py-3 text-sm font-medium text-ink-400 transition-all duration-150"
              >
                Visit Website
                <span aria-hidden>→</span>
                <LockIcon className="h-3 w-3 shrink-0 text-ink-400" />
              </button>
            </div>
            <div className="mt-3">
              {scanTier === "lite" ? (
                <span className="inline-flex items-center rounded-full border border-dashed border-ink-600 bg-ink-900/80 px-3 py-1.5 text-xs font-medium text-ink-500 opacity-70">
                  Visual verification available with full scan
                </span>
              ) : v ? (
                <SingleVisualBadge status={v.status} />
              ) : null}
            </div>
            <p className="mt-3 text-xs leading-snug text-[#6B7280]">
              Full address, website link, and detailed analysis available with
              full results.
            </p>
          </>
        )}

        {tier === "paid" && !isTop && match.website && (
          <a
            href={match.website}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 ease-out hover:bg-accent-muted"
          >
            Visit Website
            <span aria-hidden>→</span>
          </a>
        )}

        {tier === "paid" && isTop && (
          <div className="mt-5 w-full space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {match.website && (
                <a
                  href={match.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-all duration-150 ease-out hover:bg-accent-muted md:min-h-0"
                >
                  Visit Website
                  <span aria-hidden>→</span>
                </a>
              )}
              {hasEvidence && (
                <button
                  type="button"
                  onClick={() => setDetailsOpen((o) => !o)}
                  className="inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded-lg border border-ink-600 px-4 py-2.5 text-sm text-ink-200 transition-all duration-150 ease-out hover:border-ink-500 hover:bg-ink-700 md:min-h-0"
                  aria-expanded={detailsOpen}
                  aria-label={
                    detailsOpen ? "Hide evidence panel" : "View evidence panel"
                  }
                >
                  View Evidence
                  <span
                    className={`transition-transform ${detailsOpen ? "rotate-180" : ""}`}
                  >
                    ▾
                  </span>
                </button>
              )}
            </div>
            {detailsOpen && hasEvidence && (
              <TopDetailsPanel match={match} v={v} />
            )}
          </div>
        )}

        {tier === "paid" && !isTop && (
          <RunnerEvidenceAndVerification match={match} v={v} />
        )}
      </header>
    </article>
  );
}

function PaidProsCons({
  pros,
  cons,
  compact,
  topClassName = "mt-4",
}: {
  pros?: string[];
  cons?: string[];
  compact?: boolean;
  topClassName?: string;
}) {
  const proItems = (pros ?? []).filter(Boolean).slice(0, 3);
  const conItems = (cons ?? []).filter(Boolean).slice(0, 3);
  if (proItems.length === 0 && conItems.length === 0) return null;

  const titleCls = compact ? "text-[11px]" : "text-xs";
  const bodyCls = compact ? "text-[13px]" : "text-sm";

  return (
    <div
      className={`grid gap-3 border-t border-[rgba(255,255,255,0.06)] pt-3 md:grid-cols-2 md:gap-4 ${topClassName}`}
    >
      <div>
        <h4
          className={`font-semibold uppercase tracking-[0.08em] text-[#10B981] ${titleCls}`}
        >
          Pros
        </h4>
        {proItems.length > 0 ? (
          <ul className={`mt-2 space-y-1.5 ${bodyCls} leading-relaxed text-ink-200`}>
            {proItems.map((text, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#10B981]" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-2 ${bodyCls} text-ink-500`}>—</p>
        )}
      </div>
      <div>
        <h4
          className={`font-semibold uppercase tracking-[0.08em] text-[#F59E0B] ${titleCls}`}
        >
          Cons
        </h4>
        {conItems.length > 0 ? (
          <ul className={`mt-2 space-y-1.5 ${bodyCls} leading-relaxed text-ink-200`}>
            {conItems.map((text, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F59E0B]" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-2 ${bodyCls} text-ink-500`}>—</p>
        )}
      </div>
    </div>
  );
}

function FreeProsConsTeaser({
  topClassName = "mt-3",
}: {
  topClassName?: string;
}) {
  const proVisible = "Walking distance to downtown dining";
  const conVisible = "Street noise reported by residents";

  return (
    <div
      className={`grid gap-3 border-t border-[rgba(255,255,255,0.06)] pt-3 md:grid-cols-2 md:gap-4 ${topClassName}`}
    >
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#10B981]">
          Pros
        </h4>
        <ul className="mt-2 space-y-1.5">
          <li className="flex gap-2 text-sm leading-relaxed text-ink-200">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#10B981]" />
            <span>{proVisible}</span>
          </li>
          {PRO_LOCK_FILLERS.map((text, i) => (
            <li key={i} className="flex gap-2 text-sm text-ink-400">
              <LockIcon className="mt-1.5 h-4 w-4 shrink-0 text-ink-500" />
              <span className="relative flex-1 blur-[4px] select-none">
                {text}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#F59E0B]">
          Cons
        </h4>
        <ul className="mt-2 space-y-1.5">
          <li className="flex gap-2 text-sm leading-relaxed text-ink-200">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F59E0B]" />
            <span>{conVisible}</span>
          </li>
          {CON_LOCK_FILLERS.map((text, i) => (
            <li key={i} className="flex gap-2 text-sm text-ink-400">
              <LockIcon className="mt-1.5 h-4 w-4 shrink-0 text-ink-500" />
              <span className="relative flex-1 blur-[4px] select-none">
                {text}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FreeEvidenceTeaser({ match }: { match: ApartmentMatch }) {
  const items = match.evidence_for ?? [];

  if (items.length === 0) return null;

  return (
    <div className="mt-4 border-t border-[rgba(255,255,255,0.06)] pt-4">
      <h4 className="text-xs font-medium uppercase tracking-[0.06em] text-ink-400">
        Why we think it&apos;s this building (or one very similar):
      </h4>
      <ul className="mt-2 space-y-2">
        {items.map((e, i) => (
          <li key={i} className="flex gap-2 text-sm leading-snug text-ink-200">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#10B981]" />
            <span>{e}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SingleVisualBadge({
  status,
}: {
  status: VisualVerification["status"];
}) {
  const base =
    "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium";
  if (status === "STRONG_MATCH") {
    return (
      <span
        className={`${base} border-emerald-500/50 bg-emerald-500/10 text-emerald-400`}
      >
        Visually Verified
      </span>
    );
  }
  if (status === "PARTIAL_MATCH") {
    return (
      <span
        className={`${base} border-amber-500/50 bg-amber-500/10 text-amber-400`}
      >
        Partial Match
      </span>
    );
  }
  if (status === "NO_MATCH") {
    return (
      <span
        className={`${base} border-red-500/50 bg-red-500/10 text-red-400`}
      >
        No Visual Match
      </span>
    );
  }
  return (
    <span className={`${base} border-ink-600 bg-ink-900 text-ink-400`}>
      Unverified
    </span>
  );
}

function TopDetailsPanel({
  match,
  v,
}: {
  match: ApartmentMatch;
  v: VisualVerification | null | undefined;
}) {
  const penaltyBucket: ConfidencePenaltyBucket =
    v?.confidencePenaltyBucket ??
    (v?.status === "NO_MATCH" ? "interior_finishes" : "none");
  const verificationDelta =
    v && v.status !== "UNVERIFIED"
      ? verificationConfidenceAdjustment(v.status, penaltyBucket)
      : 0;

  return (
    <div className="w-full border-t border-ink-700 pt-6">
      {v && v.originalConfidence !== v.adjustedConfidence && (
        <p className="mb-4 text-xs text-ink-400">
          Adjusted from {v.originalConfidence}% to {v.adjustedConfidence}%
          {verificationDelta !== 0 &&
            ` (${verificationDelta > 0 ? "+" : ""}${verificationDelta})`}
          .
        </p>
      )}
      {match.evidence_for && match.evidence_for.length > 0 && (
        <section className="mb-4">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-emerald-400/90">
            Evidence for
          </h4>
          <ul className="space-y-2 text-sm text-ink-200">
            {match.evidence_for.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#10B981]" />
                {e}
              </li>
            ))}
          </ul>
        </section>
      )}
      {match.evidence_against && match.evidence_against.length > 0 && (
        <section className="mb-4">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-amber-400/90">
            Evidence against
          </h4>
          <ul className="space-y-2 text-sm text-ink-200">
            {match.evidence_against.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                {e}
              </li>
            ))}
          </ul>
        </section>
      )}
      {v && <VisualVerificationSection v={v} />}
    </div>
  );
}

/** Runner-up: evidence visible by default; visual verification is collapsible. */
function RunnerEvidenceAndVerification({
  match,
  v,
}: {
  match: ApartmentMatch;
  v: VisualVerification | null | undefined;
}) {
  const [verificationOpen, setVerificationOpen] = useState(false);
  const forItems = (match.evidence_for ?? []).slice(0, 3);
  const againstItems = (match.evidence_against ?? []).slice(0, 2);

  return (
    <div className="mt-5 w-full space-y-4 border-t border-ink-700 pt-5">
      {forItems.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-emerald-400/90">
            Evidence for
          </h4>
          <ul className="space-y-2 text-sm text-ink-200">
            {forItems.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#10B981]" />
                {e}
              </li>
            ))}
          </ul>
        </section>
      )}
      {againstItems.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-amber-400/90">
            Evidence against
          </h4>
          <ul className="space-y-2 text-sm text-ink-200">
            {againstItems.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                {e}
              </li>
            ))}
          </ul>
        </section>
      )}
      {v && (
        <>
          <button
            type="button"
            onClick={() => setVerificationOpen((o) => !o)}
            className="cursor-pointer text-sm font-medium text-accent-muted transition-colors duration-150 hover:text-ink-100"
            aria-expanded={verificationOpen}
          >
            {verificationOpen ? "Hide" : "Show"} visual verification ▾
          </button>
          {verificationOpen && (
            <div className="mt-3">
              <VisualVerificationSection v={v} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VisualVerificationSection({ v }: { v: VisualVerification }) {
  return (
    <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-400">
        Visual verification
      </h4>
      {v.skipReason && (
        <p className="mb-2 text-sm text-ink-400">{v.skipReason}</p>
      )}
      {v.reasoning && (
        <p className="mb-3 text-sm text-ink-200">{v.reasoning}</p>
      )}
      {(v.matchedFeatures?.length ?? 0) > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-500">
            Matched
          </div>
          <ul className="space-y-1 text-sm text-ink-200">
            {(v.matchedFeatures ?? []).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {(v.mismatchedFeatures?.length ?? 0) > 0 && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-500">
            Mismatched
          </div>
          <ul className="space-y-1 text-sm text-ink-200">
            {(v.mismatchedFeatures ?? []).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
