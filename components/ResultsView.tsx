"use client";

import type { AnalyzeResponse, ApartmentMatch } from "@/lib/types";
import DebugPanel from "./DebugPanel";
import MatchCard from "./MatchCard";
import {
  LockedPriceAssessmentPreview,
  LockedSimilarApartmentsPreview,
} from "./LockedPreviewSections";
import PriceAssessmentSection from "./PriceAssessmentSection";
import SimilarApartmentsSection from "./SimilarApartmentsSection";
import UpgradePitchCard from "./UpgradePitchCard";

interface Props {
  result: AnalyzeResponse;
  onReset: () => void;
  /** Paid credits (`?paid=1`) or dev preview (`?dev=true`) — full UI, no locks. */
  showUnlocked: boolean;
  showDebug: boolean;
  onUnlockFullResults?: () => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink-500 uppercase">
      {children}
    </p>
  );
}

export default function ResultsView({
  result,
  onReset,
  showUnlocked,
  showDebug,
  onUnlockFullResults,
}: Props) {
  const matches = result.analysis.matches ?? [];
  const top = matches[0];
  const runnersUp = matches.slice(1);
  const tier = showUnlocked ? "paid" : "free";
  const scanTier = result.scanTier;
  const hasLiteBanner = !showUnlocked && scanTier === "lite";

  if (matches.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <ResultsHeader onReset={onReset} city={result.city} />
        <LowConfidence result={result} />
        {showDebug && (
          <section id="debug" className="mt-12 border-t border-ink-700 pt-8">
            <DebugPanel result={result} expandAll />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3">
        <ResultsHeader onReset={onReset} city={result.city} />

        {hasLiteBanner && (
          <aside
            className="rounded-lg border border-white/[0.06] px-4 py-2 text-[13px] leading-snug text-ink-400"
            role="note"
          >
            <span className="font-medium text-ink-300">Free scan</span>
            {" — "}
            Basic analysis using up to 5 video frames. No visual verification or
            landmark detection. Results may not be exact.
          </aside>
        )}
      </div>

      <section
        className={`scroll-mt-8 ${hasLiteBanner ? "mt-4" : "mt-6"}`}
      >
        <SectionLabel>Top match</SectionLabel>
        {top && (
          <MatchCard
            match={top}
            rank={1}
            variant="top"
            tier={tier}
            cityLabel={result.city}
            scanTier={scanTier}
            onUnlock={onUnlockFullResults}
          />
        )}
      </section>

      {!showUnlocked && (
        <div className="mt-6">
          <UpgradePitchCard onPurchase={() => onUnlockFullResults?.()} />
        </div>
      )}

      {!showUnlocked && runnersUp.length > 0 && (
        <div className="mt-6">
          <RunnerUpStrip
            matches={runnersUp}
            onUnlock={() => onUnlockFullResults?.()}
          />
        </div>
      )}

      {runnersUp.length > 0 && (
        <section className="mt-6 scroll-mt-8">
          <SectionLabel>Other possibilities</SectionLabel>
          <div className="flex flex-col gap-3">
            {runnersUp.map((m, i) => (
              <MatchCard
                key={i}
                match={m}
                rank={i + 2}
                variant="runner"
                tier={tier}
                cityLabel={result.city}
                scanTier={scanTier}
                onUnlock={onUnlockFullResults}
              />
            ))}
          </div>
        </section>
      )}

      {!showUnlocked && (
        <div className="mt-6 flex flex-col gap-6">
          <LockedSimilarApartmentsPreview city={result.city} />
          <LockedPriceAssessmentPreview city={result.city} />
        </div>
      )}

      {showUnlocked && (
        <div className="mt-6 flex flex-col gap-6">
          <SimilarApartmentsSection result={result} />
          <PriceAssessmentSection neighborhood={result.city} />
        </div>
      )}

      {showDebug && (
        <section id="debug" className="mt-6 border-t border-ink-700 pt-6">
          <DebugPanel result={result} expandAll />
        </section>
      )}
    </div>
  );
}

function RunnerUpStrip({
  matches,
  onUnlock,
}: {
  matches: ApartmentMatch[];
  onUnlock?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1 gap-y-2 rounded-lg border border-white/[0.06] bg-[rgba(21,21,37,0.5)] px-3 py-2 text-[13px] leading-snug text-ink-300">
      {matches.map((m, i) => (
        <span key={i} className="inline-flex flex-wrap items-baseline gap-x-1">
          {i > 0 && (
            <span className="mx-1 text-ink-600" aria-hidden>
              |
            </span>
          )}
          <span className="text-ink-500">#{i + 2}</span>{" "}
          <span className="font-medium text-ink-200">???</span>{" "}
          <span className="text-ink-500">—</span>{" "}
          <span className="tabular-nums text-ink-400">
            {Math.round(m.confidence)}%
          </span>
        </span>
      ))}
      <span className="mx-1 text-ink-600" aria-hidden>
        |
      </span>
      <button
        type="button"
        onClick={onUnlock}
        className="font-medium text-accent-muted underline-offset-2 hover:text-ink-100 hover:underline"
      >
        Unlock details →
      </button>
    </div>
  );
}

function ResultsHeader({
  city,
  onReset,
}: {
  city: string;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-400">
      <div>
        Searched <span className="font-medium text-ink-100">{city}</span>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="min-h-[44px] cursor-pointer rounded-lg border border-ink-600 px-4 py-2 text-sm text-ink-200 transition-all duration-150 ease-out hover:border-ink-500 hover:bg-ink-800 md:min-h-0"
      >
        Search another
      </button>
    </div>
  );
}

function LowConfidence({ result }: { result: AnalyzeResponse }) {
  const c = result.clues;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-ink-800 px-6 py-8 md:px-8">
      <h2 className="font-display text-xl font-semibold text-ink-100">
        We couldn&apos;t match a building from this search.
      </h2>
      <p className="mt-2 text-sm text-ink-400">
        Try another link or add clues (landmarks, visible signage) in the
        optional field.
      </p>

      <dl className="mt-6 grid gap-4 text-sm md:grid-cols-2">
        <Clue title="On-screen text" items={c.onscreen_text_overlays} />
        <Clue title="Other visible text" items={c.other_visible_text} />
        <Clue title="Landmarks spotted" items={c.landmarks_spotted} />
        <Clue title="Notable features" items={c.notable_features} />
        {c.view_direction && (
          <ClueText title="View direction" value={c.view_direction} />
        )}
        {c.estimated_floor && (
          <ClueText title="Estimated floor" value={c.estimated_floor} />
        )}
        {c.price_clues && (
          <ClueText title="Price clues" value={c.price_clues} />
        )}
      </dl>
    </div>
  );
}

function Clue({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <dt className="mb-1 text-xs font-medium uppercase tracking-wider text-ink-500">
        {title}
      </dt>
      <dd>
        <ul className="space-y-1 text-ink-300">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

function ClueText({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <dt className="mb-1 text-xs font-medium uppercase tracking-wider text-ink-500">
        {title}
      </dt>
      <dd className="text-ink-300">{value}</dd>
    </div>
  );
}
