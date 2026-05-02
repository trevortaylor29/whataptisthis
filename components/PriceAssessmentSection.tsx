interface Props {
  neighborhood: string;
}

/** Paid-only: placeholder AI-style price blurb. */
export default function PriceAssessmentSection({ neighborhood }: Props) {
  return (
    <section className="scroll-mt-8 pt-2">
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.1em] text-ink-500 uppercase">
        Price assessment
      </p>
      <h2 className="sr-only">Is this a good deal?</h2>
      <div className="max-w-2xl rounded-xl border border-white/[0.06] bg-[#111118] p-5 md:p-6">
        <p className="text-sm leading-relaxed text-ink-300">
          This apartment appears priced near the middle of the range for{" "}
          <span className="text-ink-200">{neighborhood}</span>. Similar
          2-bedroom units in the surrounding blocks often list between roughly
          $1,700 and $2,600 depending on finishes and building amenities —
          we&apos;ll refine this with live comps after checkout.
        </p>
      </div>
    </section>
  );
}
