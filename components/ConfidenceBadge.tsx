interface Props {
  confidence: number;
  size?: "sm" | "md" | "lg";
}

function tier(confidence: number) {
  if (confidence >= 70) {
    return {
      className:
        "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
      dot: "bg-[#10B981]",
    };
  }
  if (confidence >= 40) {
    return {
      className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
      dot: "bg-amber-400",
    };
  }
  return {
    className: "border-red-500/40 bg-red-500/10 text-red-300",
    dot: "bg-red-400",
  };
}

export default function ConfidenceBadge({
  confidence,
  size = "md",
}: Props) {
  const t = tier(confidence);
  const padding =
    size === "lg"
      ? "px-[18px] py-2.5 text-[15px]"
      : size === "sm"
        ? "px-3 py-1.5 text-xs"
        : "px-4 py-2 text-xs";

  const weight =
    size === "lg" ? "font-semibold tracking-tight" : "font-medium tracking-tight";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border ${weight} ${padding} ${t.className}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
      {Math.round(confidence)}%
    </span>
  );
}
