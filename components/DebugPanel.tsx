"use client";

import type { AnalyzeResponse, FetchedPage } from "@/lib/types";
const EXCLUDED_FROM_SEARCH = [
  "tiktok.com",
  "instagram.com",
  "youtube.com",
  "facebook.com",
  "threads.com",
  "twitter.com",
  "x.com",
  "reddit.com",
];

export default function DebugPanel({
  result,
  expandAll,
}: {
  result: AnalyzeResponse;
  /** When true, panel is fully expanded (no collapsed &lt;details&gt; shell). */
  expandAll?: boolean;
}) {
  const queries = result.clues.search_queries ?? [];
  const totalHits = result.searchResults.reduce(
    (n, g) => n + g.hits.length,
    0,
  );
  const fetchedOk = result.fetchedPages.filter((p) => !p.error).length;
  const verifications = (result.analysis.matches ?? [])
    .map((m) => m.visual_verification)
    .filter((v): v is NonNullable<typeof v> => !!v);
  const verifiedRun = verifications.filter(
    (v) => v.status !== "UNVERIFIED",
  ).length;

  const summaryStrip = (
    <>
      <span className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-widest text-ink-400">
          debug
        </span>
        <span>What the AI saw and searched</span>
      </span>
      <span className="flex items-center gap-3 text-xs text-ink-400">
        <span className="font-mono">
          {queries.length} {queries.length === 1 ? "query" : "queries"}
          {" · "}
          {totalHits} {totalHits === 1 ? "hit" : "hits"}
          {" · "}
          {fetchedOk}/{result.fetchedPages.length} pages
          {(result.spatialLandmarkCandidates ?? []).length > 0 && (
            <>
              {" · "}
              {(result.spatialLandmarkCandidates ?? []).length}{" "}
              Places-near-landmark
            </>
          )}
          {verifications.length > 0 && (
            <>
              {" · "}
              {verifiedRun}/{verifications.length} verified
            </>
          )}
        </span>
        {!expandAll && <Chevron />}
      </span>
    </>
  );

  return (
    <details
      className="group rounded-xl border border-ink-700 bg-ink-800"
      {...(expandAll ? { open: true } : {})}
      onToggle={
        expandAll
          ? (e) => {
              const el = e.currentTarget;
              if (!el.open) el.open = true;
            }
          : undefined
      }
    >
      <summary
        className={`flex list-none items-center justify-between gap-3 px-5 py-4 text-sm text-ink-200 ${
          expandAll
            ? "cursor-default"
            : "cursor-pointer hover:text-ink-100 [&::-webkit-details-marker]:hidden"
        }`}
      >
        {summaryStrip}
      </summary>

      <div className="space-y-6 border-t border-ink-700 px-5 py-5">
        {result.sourceTiktokUrl && (
          <DebugSection title="Source video" subtitle="URL analyzed for this scan">
            <a
              href={result.sourceTiktokUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-sm font-medium text-accent-muted underline-offset-2 transition-colors duration-150 hover:text-ink-100"
            >
              {result.sourceTiktokUrl}
            </a>
          </DebugSection>
        )}
        {(result.analysis.limiting_factors?.length ?? 0) > 0 && (
          <DebugSection
            title="What made this harder"
            subtitle="From candidate analysis"
          >
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-200">
              {result.analysis.limiting_factors!.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </DebugSection>
        )}
        {result.warnings.length > 0 && (
          <DebugSection title="Warnings" subtitle="Pipeline">
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-200">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </DebugSection>
        )}
        {/* 0. OpenRouter models (429 retry / fallback) */}
        {result.openRouterLog && result.openRouterLog.length > 0 && (
          <DebugSection
            title="OpenRouter"
            subtitle="Which model served each step (after any rate-limit retry or fallback)"
          >
            <ul className="list-disc space-y-1 pl-5 font-mono text-xs text-ink-200">
              {result.openRouterLog.map((line, i) => (
                <li key={i} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-500">
              Visual verification also logs the model per candidate under
              &ldquo;Visual verification â€” listing photo sourcing&rdquo;.
            </p>
          </DebugSection>
        )}

        {/* 0. Clue-extraction vision inputs */}
        <DebugSection
          title="Clue extraction â€” images sent to vision"
          subtitle={
            result.clueExtractionVision.clueExtractionUsedLiveVision
              ? "Live OpenRouter vision call (each slot below was attached as an image part)"
              : "Mock mode: canned clues â€” vision API was not called, but this is what would have been sent"
          }
        >
          <div className="mb-3 rounded-lg border border-ink-700 bg-ink-900/60 p-3 font-mono text-xs text-ink-200">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>
                total:{" "}
                <strong className="text-ink-100">
                  {result.clueExtractionVision.totalImagesSent}
                </strong>
              </span>
              <span>
                oEmbed thumbnail:{" "}
                <strong>
                  {result.clueExtractionVision.countsBySource.oembed_thumbnail}
                </strong>
              </span>
              <span>
                video frames:{" "}
                <strong>
                  {result.clueExtractionVision.countsBySource.video_frame}
                </strong>
              </span>
              <span>
                user screenshots:{" "}
                <strong>
                  {result.clueExtractionVision.countsBySource.user_screenshot}
                </strong>
              </span>
            </div>
            {(result.clueExtractionVision.videoFramesRawFromFfmpeg !== null ||
              result.clueExtractionVision.videoFramesAfterSubsampling !==
                null) && (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-300">
                <span className="font-mono text-ink-400">Video pipeline</span>
                :{" "}
                <strong className="text-ink-200">
                  {result.clueExtractionVision.videoFramesRawFromFfmpeg ?? "â€”"}
                </strong>{" "}
                raw from ffmpeg â†’{" "}
                <strong className="text-ink-200">
                  {result.clueExtractionVision.videoFramesAfterSubsampling ?? "â€”"}
                </strong>{" "}
                after even subsampling to max 20 â†’{" "}
                <strong className="text-ink-200">
                  {result.clueExtractionVision.countsBySource.video_frame}
                </strong>{" "}
                video slot(s) on the vision call (after global image cap)
              </p>
            )}
            {result.clueExtractionVision.visionDebugFramesDirectory && (
              <p className="mt-1.5 break-all font-mono text-[10px] text-ink-400">
                Debug JPEGs on server:{" "}
                {result.clueExtractionVision.visionDebugFramesDirectory}
                {result.clueExtractionVision.visionDebugSavedFilenames &&
                  result.clueExtractionVision.visionDebugSavedFilenames.length >
                    0 && (
                    <span>
                      {" "}
                      (
                      {result.clueExtractionVision.visionDebugSavedFilenames
                        .length}{" "}
                      files:{" "}
                      {result.clueExtractionVision.visionDebugSavedFilenames.join(
                        ", ",
                      )}
                      )
                    </span>
                  )}
              </p>
            )}
            {(result.clueExtractionVision.visionDebugSavedFilenames?.length ??
              0) > result.clueExtractionVision.countsBySource.video_frame && (
              <p className="mt-1 text-[10px] text-amber-300/90">
                More JPEGs were saved on disk than video slots in this request â€”
                the global image cap may have trimmed trailing slots (check order:
                oEmbed â†’ frames â†’ screenshots).
              </p>
            )}
            {result.clueExtractionVision.totalImagesSent === 0 && (
              <p className="mt-2 text-amber-300">
                Zero images â€” clue extraction ran text-only (caption/hashtags
                only). Landmarks and on-screen text will be thin or empty.
              </p>
            )}
          </div>
          {result.clueExtractionVision.images.length > 0 ? (
            <>
              <p className="mb-2 text-[10px] text-ink-500">
                Thumbnails below are downscaled for the panel; the vision model
                still receives the full-resolution image for each slot.
              </p>
              <ol className="space-y-3 text-sm text-ink-200">
                {result.clueExtractionVision.images.map((img) => (
                  <li
                    key={img.index}
                    className="flex flex-wrap items-start gap-3 border-l-2 border-ink-700 pl-3"
                  >
                    {img.thumbnailDataUrl ? (
                      <img
                        src={img.thumbnailDataUrl}
                        alt=""
                        className="h-20 w-auto max-w-[40%] shrink-0 rounded border border-ink-600 object-contain"
                      />
                    ) : (
                      <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded border border-dashed border-ink-600 text-[10px] text-ink-500">
                        no thumb
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-[10px] text-ink-500">
                          #{img.index}
                        </span>
                        <span className="text-ink-100">{img.label}</span>
                        <span className="font-mono text-[11px] text-ink-400">
                          ({img.source}) Â· ~{img.dataUrlChars.toLocaleString()}{" "}
                          chars full-res
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-sm text-ink-400">(no image slots)</p>
          )}
        </DebugSection>

        {/* 1. Extracted clues */}
        <DebugSection
          title="Extracted clues"
          subtitle="Step 2 output from the vision model"
        >
          {result.clues.onscreen_text_overlays?.length > 0 && (
            <div className="mb-3 rounded-lg border border-accent/20 bg-accent/5 p-3">
              <div className="mb-1.5 text-[10px] font-mono uppercase tracking-widest text-accent-muted">
                On-screen text overlays (highest-signal)
              </div>
              <ul className="space-y-1 text-sm">
                {result.clues.onscreen_text_overlays.map((t, i) => (
                  <li key={i} className="font-mono text-ink-100">
                    &ldquo;{t}&rdquo;
                  </li>
                ))}
              </ul>
            </div>
          )}
          <CodeBlock>{JSON.stringify(result.clues, null, 2)}</CodeBlock>
        </DebugSection>

        {/* 2.25 Places near landmarks */}
        <DebugSection
          title="Places â€” apartments near landmarks"
          subtitle="Serper Places: geocode each landmark, filter residential POIs within ~500m (fed to candidate analysis)"
        >
          {(result.spatialLandmarkCandidates?.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-400">
              (none â€” no landmarks, Places returned nothing, or step failed)
            </p>
          ) : (
            <CodeBlock>
              {JSON.stringify(result.spatialLandmarkCandidates, null, 2)}
            </CodeBlock>
          )}
        </DebugSection>

        {/* 2. Search queries */}
        <DebugSection
          title="Search queries"
          subtitle="Sent to Serper with social-media exclusions appended"
        >
          {queries.length === 0 ? (
            <p className="text-sm text-ink-400">
              (none â€” the AI returned no queries)
            </p>
          ) : (
            <ol className="space-y-1.5">
              {queries.map((q, i) => (
                <li
                  key={i}
                  className="flex gap-2 font-mono text-sm text-ink-100"
                >
                  <span className="select-none text-ink-500">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="break-words">{q}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-[11px] text-ink-500">
            Each query is augmented with{" "}
            {EXCLUDED_FROM_SEARCH.map((h, i) => (
              <span key={h}>
                <code className="font-mono text-ink-400">-site:{h}</code>
                {i < EXCLUDED_FROM_SEARCH.length - 1 ? " " : ""}
              </span>
            ))}{" "}
            so social/video results are filtered out before scoring.
          </p>
        </DebugSection>

        {/* 2.45 Visual verification â€” how listing photos were found */}
        <DebugSection
          title="Visual verification â€” listing photo sourcing"
          subtitle="Website interiors when possible; then Google Images (interior + exterior); Serper web HTML as last resort for interiors"
        >
          {(result.analysis.matches ?? []).some(
            (m) => (m.visual_verification?.listingPhotoTrace?.length ?? 0) > 0,
          ) ? (
            <div className="space-y-3">
              {(result.analysis.matches ?? []).map((m, i) => {
                const trace = m.visual_verification?.listingPhotoTrace;
                if (!trace?.length) return null;
                return (
                  <div
                    key={i}
                    className="rounded-lg border border-ink-700 bg-ink-900/50 p-3"
                  >
                    <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-400">
                      {m.name}{" "}
                      <span className="text-ink-500">
                        ({m.visual_verification?.status})
                      </span>
                    </div>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink-300">
                      {trace.map((line, j) => (
                        <li key={j}>{line}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-ink-400">
              (no traces â€” mock mode short-circuits verification, or listings
              used canned photos only)
            </p>
          )}
        </DebugSection>

        {/* 2.5 Fetched listing pages */}
        <DebugSection
          title="Fetched listing pages"
          subtitle={`Top ${result.fetchedPages.length} URL${result.fetchedPages.length === 1 ? "" : "s"} fetched in full for the AI`}
        >
          {result.fetchedPages.length === 0 ? (
            <p className="text-sm text-ink-400">
              (no pages were fetched â€” search returned no listing-site URLs)
            </p>
          ) : (
            <div className="space-y-3">
              {result.fetchedPages.map((page, i) => (
                <FetchedPageCard key={i} page={page} index={i + 1} />
              ))}
            </div>
          )}
        </DebugSection>

        {/* 3. Raw Serper results */}
        <DebugSection
          title="Raw search results"
          subtitle={`${totalHits} hits across ${result.searchResults.length} ${
            result.searchResults.length === 1 ? "query" : "queries"
          }`}
        >
          {result.searchResults.length === 0 ? (
            <p className="text-sm text-ink-400">(no searches were run)</p>
          ) : (
            <div className="space-y-4">
              {result.searchResults.map((group, gi) => (
                <div
                  key={gi}
                  className="rounded-lg border border-ink-700 bg-ink-900/60 p-3"
                >
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <code className="break-words font-mono text-xs text-ink-200">
                      &ldquo;{group.query}&rdquo;
                    </code>
                    <span className="flex-none font-mono text-[10px] text-ink-400">
                      {group.hits.length} hits
                    </span>
                  </div>
                  {group.hits.length === 0 ? (
                    <p className="text-xs text-ink-400">(no results)</p>
                  ) : (
                    <ol className="space-y-2.5">
                      {group.hits.map((hit, hi) => (
                        <li
                          key={hi}
                          className="border-l-2 border-ink-700 pl-3"
                        >
                          {hit.link ? (
                            <a
                              href={hit.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block break-words text-sm text-ink-100 underline decoration-ink-600 underline-offset-2 hover:decoration-accent hover:text-accent-muted"
                            >
                              {hit.title || "(no title)"}
                            </a>
                          ) : (
                            <span className="block text-sm text-ink-200">
                              {hit.title || "(no title)"}
                            </span>
                          )}
                          {hit.link && (
                            <code className="mt-0.5 block break-all font-mono text-[11px] text-ink-400">
                              {hit.link}
                            </code>
                          )}
                          {hit.snippet && (
                            <p className="mt-1 text-xs text-ink-300">
                              {hit.snippet}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          )}
        </DebugSection>
      </div>
    </details>
  );
}

function DebugSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-xs font-mono uppercase tracking-widest text-ink-300">
          {title}
        </h4>
        {subtitle && <span className="text-[10px] text-ink-500">{subtitle}</span>}
      </header>
      {children}
    </section>
  );
}

function FetchedPageCard({
  page,
  index,
}: {
  page: FetchedPage;
  index: number;
}) {
  const failed = !!page.error;
  return (
    <div
      className={`rounded-lg border p-3 ${
        failed
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-ink-700 bg-ink-900/60"
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-400">
              page {index}
            </span>
            {failed ? (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-amber-300">
                fetch failed
              </span>
            ) : (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-emerald-300">
                ok
              </span>
            )}
          </div>
          {page.title && (
            <p className="mt-1 break-words text-sm font-medium text-ink-100">
              {page.title}
            </p>
          )}
          <a
            href={page.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block break-all font-mono text-[11px] text-ink-400 underline decoration-ink-600 underline-offset-2 hover:text-accent-muted"
          >
            {page.url}
          </a>
        </div>
        {!failed && (
          <span className="flex-none whitespace-nowrap font-mono text-[10px] text-ink-500">
            {(page.htmlBytes / 1024).toFixed(1)}KB · {page.content.length} chars
          </span>
        )}
      </div>

      {failed ? (
        <p className="text-xs text-amber-300">{page.error}</p>
      ) : (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-ink-700 bg-ink-900 p-2 font-mono text-[11px] leading-relaxed text-ink-200">
          {page.content}
        </pre>
      )}
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg border border-ink-700 bg-ink-900/80 p-3 font-mono text-xs leading-relaxed text-ink-200">
      {children}
    </pre>
  );
}

function Chevron() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="transition-transform group-open:rotate-180"
    >
      <path
        d="M3.5 5L7 8.5L10.5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
