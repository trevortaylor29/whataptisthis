"use client";

import { useState } from "react";

interface Props {
  onClose: () => void;
  visitorId: string | null;
  onResult: (message: string) => void;
}

export default function RestorePurchasesModal({
  onClose,
  visitorId,
  onResult,
}: Props) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleRestore() {
    const trimmed = email.trim();
    if (!trimmed || !visitorId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, fingerprint: visitorId }),
      });
      const data = (await res.json()) as {
        restored?: boolean;
        credits?: number;
        error?: string;
      };
      if (!res.ok) {
        onResult(data.error ?? "Restore failed.");
        return;
      }
      if (data.restored && typeof data.credits === "number") {
        onResult(`Restored ${data.credits} credit(s) to this browser.`);
        onClose();
      } else {
        onResult("No purchases found for that email.");
      }
    } catch {
      onResult("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-page/90 p-4 backdrop-blur-[2px] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-ink-700 bg-ink-800 p-6 shadow-xl">
        <h2
          id="restore-title"
          className="font-display text-lg font-semibold text-ink-100"
        >
          Restore purchases
        </h2>
        <p className="mt-2 text-sm text-ink-400">
          Enter the email you used at checkout. Any remaining credits from that
          account will move to this browser.
        </p>
        <label className="mt-4 block text-sm font-medium text-ink-200">
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy || !visitorId}
            className="mt-2 w-full rounded-lg border border-ink-600 bg-ink-900 px-4 py-3 text-ink-100 placeholder:text-ink-500 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            placeholder="you@example.com"
          />
        </label>
        {!visitorId && (
          <p className="mt-2 text-xs text-amber-400">
            Visitor id not ready — wait a moment or refresh.
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-ink-600 px-4 py-3 text-sm font-medium text-ink-200 hover:bg-ink-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !email.trim() || !visitorId}
            onClick={() => void handleRestore()}
            className="min-h-[44px] rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-[#8B5CF6] disabled:cursor-not-allowed disabled:bg-ink-600"
          >
            {busy ? "Working…" : "Restore"}
          </button>
        </div>
      </div>
    </div>
  );
}
