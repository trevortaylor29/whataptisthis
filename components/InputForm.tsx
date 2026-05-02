"use client";

import { useState, type ReactNode } from "react";
import type { AnalyzeRequest } from "@/lib/types";

interface Props {
  onSubmit: (req: AnalyzeRequest) => void;
  /** True while a search request is in flight — disables fields only */
  busy?: boolean;
  /** Disables the submit button (visitor id, credits, busy, etc.) */
  submitDisabled?: boolean;
  /** Helper text under the submit button (string or rich content, e.g. inline link) */
  statusHint?: ReactNode;
}

const POPULAR_CITIES = [
  "Austin, TX",
  "New York, NY",
  "Los Angeles, CA",
  "Chicago, IL",
  "Miami, FL",
  "Houston, TX",
  "Dallas, TX",
  "San Francisco, CA",
  "Seattle, WA",
  "Denver, CO",
  "Atlanta, GA",
  "Boston, MA",
  "Washington, DC",
  "Nashville, TN",
  "Phoenix, AZ",
  "San Diego, CA",
  "Portland, OR",
  "Philadelphia, PA",
  "Minneapolis, MN",
  "Charlotte, NC",
];

const TIKTOK_RE =
  /^https?:\/\/(www\.|vm\.|m\.|vt\.)?(tiktok\.com|instagram\.com)\//i;

export default function InputForm({
  onSubmit,
  busy = false,
  submitDisabled = false,
  statusHint,
}: Props) {
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [city, setCity] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};

    const url = tiktokUrl.trim();
    if (!url.length) {
      next.tiktokUrl = "Paste a TikTok link.";
    } else if (!TIKTOK_RE.test(url)) {
      next.tiktokUrl = "That doesn't look like a TikTok or Instagram link.";
    }

    const cityTrimmed = city.trim();
    if (!cityTrimmed) {
      next.city = "City is required so we know where to search.";
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    onSubmit({
      city: cityTrimmed,
      additionalContext: additionalContext.trim() || undefined,
      tiktokUrl: url,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <Field label="TikTok link" htmlFor="tiktokUrl" error={errors.tiktokUrl} required>
        <input
          id="tiktokUrl"
          name="tiktokUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://www.tiktok.com/@creator/video/..."
          value={tiktokUrl}
          onChange={(e) => setTiktokUrl(e.target.value)}
          disabled={busy}
          className={inputClass(!!errors.tiktokUrl)}
        />
      </Field>

      <Field label="City" htmlFor="city" error={errors.city} required>
        <input
          id="city"
          name="city"
          list="popular-cities"
          autoComplete="off"
          placeholder="e.g. Austin, TX"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          disabled={busy}
          className={inputClass(!!errors.city)}
        />
        <datalist id="popular-cities">
          {POPULAR_CITIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="additionalContext"
          className="text-xs font-medium uppercase tracking-wider text-ink-500"
        >
          Other clues{" "}
          <span className="font-normal normal-case text-ink-600">
            (optional)
          </span>
        </label>
        <input
          id="additionalContext"
          name="additionalContext"
          type="text"
          autoComplete="off"
          placeholder="Landmarks, signage, neighborhood hints…"
          value={additionalContext}
          onChange={(e) => setAdditionalContext(e.target.value)}
          disabled={busy}
          className={`${inputClass(false)} py-2.5 text-sm`}
        />
      </div>

      <button
        type="submit"
        disabled={submitDisabled}
        className="flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-6 py-4 text-base font-bold text-white transition-all duration-150 ease-out hover:enabled:-translate-y-px hover:enabled:bg-[#9355F6] disabled:cursor-not-allowed disabled:bg-ink-600 disabled:text-ink-500"
      >
        Find this apartment
        <span aria-hidden>→</span>
      </button>

      {statusHint ? (
        <p className="text-center text-[13px] leading-snug text-ink-400">
          {statusHint}
        </p>
      ) : null}

      <p className="text-center text-[13px] leading-snug text-[#6B7280]">
        No signup required.
      </p>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-ink-200"
      >
        {label}
        {required && <span className="ml-1 text-accent-muted">*</span>}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-amber-400">
          {error}
        </p>
      )}
    </div>
  );
}

function inputClass(hasError: boolean) {
  return [
    "w-full rounded-xl border bg-[#141420] px-4 py-3.5 text-base text-ink-100",
    "placeholder:text-ink-500",
    "transition-colors",
    "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
    "disabled:cursor-not-allowed disabled:opacity-60",
    hasError
      ? "border-amber-500/60 focus:border-amber-400"
      : "border-[#1E1E2E] hover:border-ink-600",
  ].join(" ");
}
