"use client";

import ConfidenceBadge from "./ConfidenceBadge";

/** Long-form explainer: how it works, example, FAQ — lives on /about only. */
export default function AboutContent() {
  return (
    <div className="border-t border-[#1E1E2E] bg-[#08080F]">
      <div className="mx-auto max-w-5xl px-4 py-16 md:px-8 md:py-24">
        <section className="mb-20 md:mb-28">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-100 md:text-[28px]">
            How it works
          </h2>
          <div className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
            <StepBlock
              n={1}
              title="Paste a TikTok link"
              body="Copy the link from any apartment tour video."
            />
            <StepBlock
              n={2}
              title="AI analyzes the video"
              body="We extract clues from captions, text overlays, and video frames on full scans."
            />
            <StepBlock
              n={3}
              title="Get the building"
              body="See the apartment name, details, and direct links when you unlock full results."
            />
          </div>
        </section>

        <section className="mb-20 md:mb-28">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-100 md:text-[28px]">
            Example result
          </h2>
          <p className="mt-3 max-w-2xl text-base text-ink-400">
            What a full paid scan can surface — addresses, evidence, and
            verification against listing photos.
          </p>
          <div className="mt-10 rounded-xl border border-[#1E1E2E] bg-[#12121F] p-6 md:p-8">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-500">
              Example result
            </p>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-display text-xl font-semibold text-ink-100 md:text-2xl">
                  The Bowie apartments
                </h3>
                <p className="mt-2 text-sm text-ink-400">
                  711 W 26th St, Austin, TX 78705
                </p>
              </div>
              <ConfidenceBadge confidence={89} size="lg" />
            </div>
            <p className="mt-6 text-base leading-relaxed text-ink-200">
              On-screen text matches the building&apos;s branded signage; search
              snippets tie the unit style to this property&apos;s floor plans.
            </p>
            <div className="mt-6 space-y-2 text-sm text-ink-300">
              <p className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                Rooftop pool geometry matches listing amenity photos.
              </p>
              <p className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                Street-level signage aligns with “West Campus” positioning.
              </p>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <span className="inline-flex rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                Visually Verified
              </span>
              <button
                type="button"
                disabled
                className="pointer-events-none rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white opacity-90"
              >
                Visit Website →
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-100 md:text-[28px]">
            FAQ
          </h2>
          <div className="mt-8 flex flex-col gap-4">
            <FaqItem
              q="How does it work?"
              a="You paste a TikTok URL and tell us the city. Our pipeline reads the caption (everyone gets this), then optional upgrade paths pull frames from the video, search listings, rank candidates, and optionally compare listing photos to your clip."
            />
            <FaqItem
              q="How accurate is it?"
              a="Our AI identifies apartments correctly in many cases when the video contains location text, landmarks, or distinctive building features. Results vary with video quality and how much is visible on screen."
            />
            <FaqItem
              q="What do I get with full results?"
              a="Full street addresses, website links, frame-by-frame analysis on eligible scans, visual verification against listing imagery, similar apartments nearby, and a quick price read for the area."
            />
            <FaqItem
              q="Is my data stored?"
              a="We do not store your videos or personal information."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function StepBlock({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#1E1E2E] bg-[#12121F] font-display text-lg font-semibold text-ink-100">
        {n}
      </div>
      <div>
        <h3 className="font-display text-lg font-semibold text-ink-100">
          {title}
        </h3>
        <p className="mt-2 text-base leading-relaxed text-ink-400">{body}</p>
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-xl border border-[#1E1E2E] bg-[#12121F] px-5 py-4 md:px-6 md:py-5">
      <summary className="cursor-pointer list-none font-medium text-ink-100 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-4">
          {q}
          <span className="text-ink-500 transition-transform group-open:rotate-180">
            ▾
          </span>
        </span>
      </summary>
      <p className="mt-4 text-base leading-relaxed text-ink-400">{a}</p>
    </details>
  );
}
