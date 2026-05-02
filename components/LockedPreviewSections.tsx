"use client";

function LockOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-ink-900/75 backdrop-blur-[2px]">
      <svg
        className="h-8 w-8 text-accent-muted"
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
      <span className="max-w-[14rem] text-center text-xs font-medium text-ink-200">
        {label}
      </span>
    </div>
  );
}

/** Placeholder blurred comps — communicates paid-only value (not live data). */
export function LockedSimilarApartmentsPreview({ city }: { city: string }) {
  const fake = [
    { name: "The Riley on Lamar", price: "From $2,195" },
    { name: "Eastside Commons", price: "From $1,895" },
    { name: "Skyline at Gateway", price: "From $2,450" },
    { name: "South Congress Lofts", price: "From $2,680" },
  ];

  return (
    <section className="relative scroll-mt-8">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink-500 uppercase">
        Similar nearby
      </p>
      <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-ink-800/50 p-5 md:p-6">
        <p className="mb-1 text-xs text-ink-500">Near {city}</p>
        <ul className="flex flex-col gap-3 blur-sm">
          {fake.map((row) => (
            <li
              key={row.name}
              className="flex items-center justify-between border-b border-ink-700/50 pb-3 last:border-0 last:pb-0"
            >
              <span className="font-medium text-ink-200">{row.name}</span>
              <span className="text-sm text-ink-400">{row.price}</span>
            </li>
          ))}
        </ul>
        <LockOverlay label="Available with full results" />
      </div>
    </section>
  );
}

export function LockedPriceAssessmentPreview({ city }: { city: string }) {
  return (
    <section className="relative scroll-mt-8">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink-500 uppercase">
        Price assessment
      </p>
      <div className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-ink-800/50 p-5 md:p-7">
        <div className="blur-md select-none">
          <p className="text-sm leading-relaxed text-ink-300">
            Typical asking rents around{" "}
            <span className="text-ink-100">{city}</span> for comparable units
            span roughly $1,700–$2,800 depending on finish level and floor — this
            tour&apos;s promo pricing would be benchmarked against live comps.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-400">
            Breakdown by bedroom count, seasonal trends, and landlord
            concessions updates automatically with full results.
          </p>
        </div>
        <LockOverlay label="Available with full results" />
      </div>
    </section>
  );
}
