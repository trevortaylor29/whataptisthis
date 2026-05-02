import type { AnalyzeResponse } from "@/lib/types";

interface Props {
  result: AnalyzeResponse;
}

/** Paid-only: placeholder rows derived from search hits (not real listings). */
export default function SimilarApartmentsSection({ result }: Props) {
  const city = result.city;
  const namesTop = new Set(
    (result.analysis.matches ?? []).map((m) => (m.name ?? "").toLowerCase()),
  );

  const candidates: { title: string; url?: string; snippet?: string }[] = [];
  for (const g of result.searchResults) {
    for (const h of g.hits) {
      if (candidates.length >= 8) break;
      const t = (h.title ?? "").trim();
      if (!t || namesTop.has(t.toLowerCase())) continue;
      candidates.push({ title: t, url: h.link, snippet: h.snippet });
    }
    if (candidates.length >= 8) break;
  }

  const shown = candidates.slice(0, 5);
  if (shown.length === 0) {
    return (
      <section className="scroll-mt-8 pt-2">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.1em] text-ink-500 uppercase">
          Similar nearby
        </p>
        <h2 className="sr-only">Similar apartments nearby</h2>
        <p className="mt-2 text-sm text-ink-400">
          No additional listings were available to surface here for this search.
        </p>
      </section>
    );
  }

  return (
    <section className="scroll-mt-8 pt-2">
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.1em] text-ink-500 uppercase">
        Similar nearby
      </p>
      <h2 className="sr-only">Similar apartments nearby</h2>
      <p className="mt-2 max-w-xl text-sm text-ink-400">
        Other rentals in the same area at roughly comparable price points
        (placeholder until we wire live comps).
      </p>
      <ul className="mt-6 flex flex-col gap-4">
        {shown.map((c, i) => (
          <li
            key={i}
            className="rounded-xl border border-white/[0.06] bg-[#111118] px-4 py-4"
          >
            <p className="font-medium text-ink-100">{c.title}</p>
            <p className="mt-1 text-sm text-ink-400">
              Near {city} · typical range $1,800–$2,800 (estimate)
            </p>
            {c.url && (
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex cursor-pointer text-sm font-medium text-accent-muted transition-colors duration-150 hover:text-ink-100"
              >
                View listing →
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
