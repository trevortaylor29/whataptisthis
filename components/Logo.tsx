/** Wordmark: What + Apt (accent) + IsThis — magnifying glass marks search intent. */
export default function Logo({
  className = "",
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  const textSize = compact
    ? "text-sm md:text-base"
    : "text-xl sm:text-2xl md:text-3xl";

  return (
    <span
      className={`inline-flex items-center gap-2.5 font-display font-bold tracking-tight ${className}`}
    >
      <span className={`inline-flex items-baseline gap-0 ${textSize}`}>
        <span className="text-white">What</span>
        <span className="text-[#A78BFA]">Apt</span>
        <span className="text-white">IsThis</span>
      </span>
      <svg
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 text-[#A78BFA]"
        aria-hidden
      >
        <path
          d="M2 14L6 10M11 7C11 9.20914 9.20914 11 7 11C4.79086 11 3 9.20914 3 7C3 4.79086 4.79086 3 7 3C9.20914 3 11 4.79086 11 7Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
