"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isDebugModeFromSearchParams } from "@/lib/is-debug-mode";
import InputForm from "@/components/InputForm";
import SubheadlineTypewriter from "@/components/SubheadlineTypewriter";
import Logo from "@/components/Logo";
import ProcessingView from "@/components/ProcessingView";
import RestorePurchasesModal from "@/components/RestorePurchasesModal";
import ResultsView from "@/components/ResultsView";
import SiteFooter from "@/components/SiteFooter";
import { useVisitorId } from "@/hooks/useVisitorId";
import { CREDIT_PACK_BUTTON } from "@/lib/pricing";
import type {
  AnalyzeErrorResponse,
  AnalyzeRequest,
  AnalyzeResponse,
} from "@/lib/types";

type View =
  | { kind: "input" }
  | { kind: "processing"; finishing: boolean }
  | { kind: "results"; result: AnalyzeResponse }
  | { kind: "error"; message: string; details?: string };

const MIN_PROCESSING_MS = 600;

type CreditsState = {
  freeScansRemaining: number;
  paidCredits: number;
  scanTier: "full" | "lite" | "blocked";
};

export default function HomePage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <HomePageInner />
    </Suspense>
  );
}

function PageFallback() {
  return (
    <div className="flex min-h-screen min-h-[100dvh] w-full items-center justify-center bg-page px-4">
      <div className="h-10 w-56 animate-pulse rounded bg-ink-800" />
    </div>
  );
}

const DEBUG_SESSION_KEY = "apt:pipeline-debug";

function HomePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDebug = isDebugModeFromSearchParams(searchParams);
  const devMode = searchParams.get("dev") === "true";

  const [stickyDebug, setStickyDebug] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (urlDebug) {
        sessionStorage.setItem(DEBUG_SESSION_KEY, "1");
        setStickyDebug(true);
        return;
      }
      setStickyDebug(sessionStorage.getItem(DEBUG_SESSION_KEY) === "1");
    } catch {
      setStickyDebug(false);
    }
  }, [urlDebug]);

  const showDebug = urlDebug || stickyDebug;

  const homeHref = useMemo(() => {
    const qs = searchParams.toString();
    return qs ? `/?${qs}` : "/";
  }, [searchParams]);

  const [view, setView] = useState<View>({ kind: "input" });
  const [limitKind, setLimitKind] = useState<null | "IP_RATE_LIMIT">(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [purchaseToast, setPurchaseToast] = useState<string | null>(null);

  const { visitorId, ready: visitorReady } = useVisitorId();
  const [credits, setCredits] = useState<CreditsState | null>(null);

  const refetchCredits = useCallback(async (): Promise<CreditsState | null> => {
    if (!visitorId) {
      setCredits(null);
      return null;
    }
    try {
      const r = await fetch(
        `/api/credits?visitorId=${encodeURIComponent(visitorId)}`,
      );
      const j = (await r.json()) as CreditsState;
      setCredits(j);
      return j;
    } catch {
      setCredits(null);
      return null;
    }
  }, [visitorId]);

  useEffect(() => {
    void refetchCredits();
  }, [refetchCredits]);

  const hrefWithoutPurchase = useCallback(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("purchase");
    const q = p.toString();
    return q ? `/?${q}` : "/";
  }, [searchParams]);

  const purchaseSuccessGen = useRef(0);

  useEffect(() => {
    function openRestore() {
      setRestoreOpen(true);
    }
    window.addEventListener("apt-open-restore", openRestore);
    return () => window.removeEventListener("apt-open-restore", openRestore);
  }, []);

  useEffect(() => {
    const purchase = searchParams.get("purchase");
    if (purchase === "cancelled") {
      router.replace(hrefWithoutPurchase(), { scroll: false });
      return;
    }
    if (purchase !== "success") return;
    if (!visitorReady || !visitorId) return;

    const gen = ++purchaseSuccessGen.current;
    let cancelled = false;

    (async () => {
      setPurchaseToast(
        "Purchase complete! You have 5 full scans ready.",
      );

      const maxAttempts = 10;
      const delayMs = 400;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (cancelled || gen !== purchaseSuccessGen.current) return;
        const snap = await refetchCredits();
        if (snap?.scanTier === "full") break;
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      if (cancelled || gen !== purchaseSuccessGen.current) return;
      router.replace(hrefWithoutPurchase(), { scroll: false });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    searchParams,
    visitorReady,
    visitorId,
    router,
    refetchCredits,
    hrefWithoutPurchase,
  ]);

  useEffect(() => {
    if (!purchaseToast) return;
    const t = window.setTimeout(() => setPurchaseToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [purchaseToast]);

  const startCheckout = useCallback(async () => {
    if (!visitorId) return;
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: visitorId }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setPurchaseToast(data.error ?? "Checkout failed.");
    } catch {
      setPurchaseToast("Checkout failed.");
    }
  }, [visitorId]);

  const inputStatusHint = useMemo(() => {
    if (!visitorReady || !credits) {
      return visitorReady ? "Checking credits…" : "Loading…";
    }
    if (devMode) return "Dev mode — full pipeline, no charge";
    if (credits.scanTier === "full") {
      return `${credits.paidCredits} full scan${credits.paidCredits === 1 ? "" : "s"} remaining`;
    }
    if (credits.scanTier === "lite") return "1 free scan remaining";
    if (credits.scanTier === "blocked") {
      return (
        <>
          No scans remaining —{" "}
          <button
            type="button"
            onClick={() => void startCheckout()}
            className="font-medium text-accent underline decoration-accent/60 underline-offset-2 hover:text-accent-muted"
          >
            purchase credits to continue
          </button>
        </>
      );
    }
    return null;
  }, [visitorReady, credits, devMode, startCheckout]);

  const showBuyCreditsButton =
    visitorReady &&
    !devMode &&
    credits !== null &&
    credits.scanTier === "blocked";

  const submitBlocked =
    visitorReady &&
    !devMode &&
    credits !== null &&
    credits.scanTier === "blocked";

  async function handleSubmit(req: AnalyzeRequest) {
    setView({ kind: "processing", finishing: false });
    const startedAt = Date.now();

    try {
      const apiPath = `/api/analyze${devMode ? "?dev=true" : ""}`;
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...req,
          visitorId: visitorId ?? undefined,
        }),
      });

      const data = (await res.json()) as
        | AnalyzeResponse
        | AnalyzeErrorResponse;

      setView({ kind: "processing", finishing: true });

      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, MIN_PROCESSING_MS - elapsed);
      await new Promise((r) => setTimeout(r, wait));

      if (!data.ok) {
        if (res.status === 429 && data.code === "IP_RATE_LIMIT") {
          setLimitKind("IP_RATE_LIMIT");
          setView({ kind: "input" });
          return;
        }
        if (
          res.status === 403 &&
          (data.code === "no_credits" || data.code === "NO_CREDITS")
        ) {
          setView({ kind: "input" });
          void startCheckout();
          return;
        }
        setView({
          kind: "error",
          message: data.error,
          details: data.details,
        });
      } else {
        setView({ kind: "results", result: data });
        void refetchCredits();
        if (typeof window !== "undefined") {
          try {
            if (urlDebug) sessionStorage.setItem(DEBUG_SESSION_KEY, "1");
          } catch {
            /* ignore */
          }
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
    } catch (err) {
      setView({
        kind: "error",
        message: "Network error",
        details: (err as Error).message,
      });
    }
  }

  function reset() {
    setView({ kind: "input" });
    void refetchCredits();
  }

  const inputBusy = view.kind === "processing";

  return (
    <div className="flex min-h-[100dvh] flex-col bg-page">
      {view.kind === "input" ? (
        <div className="relative min-h-screen min-h-[100dvh] w-full bg-page">
          <header className="pointer-events-auto absolute left-0 right-0 top-0 z-30 px-6 pt-8 md:px-10 md:pt-10">
            <Link
              href={homeHref}
              className="inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-page"
            >
              <Logo />
            </Link>
          </header>

          {/*
            Full-viewport flex center: pointer-events-none on the shell so empty space
            does not block the header/footer (z-30). The form column re-enables events.
          */}
          <div className="pointer-events-none relative z-20 flex min-h-screen min-h-[100dvh] w-full items-center justify-center px-4 pb-28 pt-20 md:px-8 md:pb-32 md:pt-24">
            <div className="pointer-events-auto relative z-20 w-full max-w-[34rem]">
              <div
                className="mb-6 h-px w-12 bg-[rgba(124,58,237,0.55)]"
                aria-hidden
              />
              <h1 className="mb-6 font-display text-[2.5rem] font-bold leading-[1.05] tracking-tight text-ink-100 md:text-[56px] lg:text-[64px]">
                Find any apartment from a TikTok.
              </h1>
              <SubheadlineTypewriter />

              <div className="rounded-2xl border border-[rgba(124,58,237,0.2)] bg-surface p-8">
                <InputForm
                  onSubmit={handleSubmit}
                  busy={inputBusy}
                  submitDisabled={
                    inputBusy || !visitorReady || submitBlocked
                  }
                  statusHint={inputStatusHint}
                />
                {showBuyCreditsButton && (
                  <button
                    type="button"
                    onClick={() => void startCheckout()}
                    disabled={!visitorId}
                    className="mt-4 flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-xl border border-accent/45 bg-ink-900/60 px-4 py-2.5 text-sm font-semibold text-accent transition-colors hover:border-accent/70 hover:bg-ink-800 hover:text-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Buy {CREDIT_PACK_BUTTON}
                  </button>
                )}
                {devMode && (
                  <p className="mt-4 text-center text-xs text-amber-500/90">
                    Dev mode: rate limits bypassed — remove ?dev=true before
                    launch.
                  </p>
                )}
              </div>
            </div>
          </div>

          <footer className="pointer-events-auto absolute bottom-0 left-0 right-0 z-30 border-t border-white/[0.06] bg-page px-4 py-5 text-center text-[13px] text-[#6B7280]">
            <Link
              href="/about"
              className="underline-offset-2 hover:text-ink-300 hover:underline"
            >
              About
            </Link>
            <span className="mx-3 text-ink-600">·</span>
            <Link
              href="/contact"
              className="underline-offset-2 hover:text-ink-300 hover:underline"
            >
              Contact
            </Link>
            <span className="mx-3 text-ink-600">·</span>
            <Link
              href="/legal"
              className="underline-offset-2 hover:text-ink-300 hover:underline"
            >
              Legal
            </Link>
            <span className="mx-3 text-ink-600">·</span>
            <button
              type="button"
              onClick={() => setRestoreOpen(true)}
              className="underline-offset-2 hover:text-ink-300 hover:underline"
            >
              Restore purchases
            </button>
          </footer>
        </div>
      ) : (
        <>
          <main className="flex flex-1 flex-col items-center">
            <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:px-8 md:py-8">
              <header className="mb-5 md:mb-6">
                <Link
                  href={homeHref}
                  className="inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-page"
                >
                  <Logo />
                </Link>
              </header>

              {view.kind === "processing" && (
                <div className="mx-auto w-full max-w-2xl">
                  <ProcessingView finishing={view.finishing} />
                </div>
              )}

              {view.kind === "results" && (
                <div className="mx-auto w-full max-w-3xl">
                  <ResultsView
                    result={view.result}
                    onReset={reset}
                    showUnlocked={
                      view.result.scanTier === "full" || devMode
                    }
                    showDebug={showDebug}
                    onUnlockFullResults={() => void startCheckout()}
                  />
                </div>
              )}

              {view.kind === "error" && (
                <div className="mx-auto w-full max-w-2xl">
                  <ErrorView
                    message={view.message}
                    details={view.details}
                    onReset={reset}
                  />
                </div>
              )}
            </div>
          </main>

          <SiteFooter />
        </>
      )}

      {purchaseToast && (
        <div
          className="fixed bottom-6 left-1/2 z-[70] max-w-md -translate-x-1/2 rounded-xl border border-emerald-500/30 bg-ink-800 px-5 py-3 text-center text-sm text-emerald-200 shadow-lg"
          role="status"
        >
          {purchaseToast}
        </div>
      )}

      {limitKind && (
        <LimitModal kind={limitKind} onClose={() => setLimitKind(null)} />
      )}

      {restoreOpen && (
        <RestorePurchasesModal
          visitorId={visitorId}
          onClose={() => setRestoreOpen(false)}
          onResult={(msg) => {
            setPurchaseToast(msg);
            void refetchCredits();
          }}
        />
      )}
    </div>
  );
}

function LimitModal({
  kind,
  onClose,
}: {
  kind: "IP_RATE_LIMIT";
  onClose: () => void;
}) {
  const title = "Daily limit reached";
  const body =
    "Too many searches from this network today (10 max). Try again tomorrow.";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-page/90 p-4 backdrop-blur-[2px] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="limit-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-ink-700 bg-ink-800 p-6 shadow-xl">
        <h2
          id="limit-title"
          className="font-display text-lg font-semibold text-ink-100"
        >
          {title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-400">{body}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-ink-600 px-4 py-3 text-sm font-medium text-ink-200 hover:bg-ink-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorView({
  message,
  details,
  onReset,
}: {
  message: string;
  details?: string;
  onReset: () => void;
}) {
  return (
    <div className="rounded-xl border border-[#1E1E2E] bg-ink-800 px-6 py-8 md:px-8">
      <h2 className="font-display text-xl font-semibold text-ink-100">
        Something went wrong.
      </h2>
      <p className="mt-2 text-sm text-ink-400">{message}</p>
      {details && (
        <pre className="mt-4 overflow-x-auto rounded-lg border border-ink-700 bg-ink-900 p-3 text-xs text-ink-400">
          {details}
        </pre>
      )}
      <button
        type="button"
        onClick={onReset}
        className="mt-6 min-h-[44px] rounded-lg bg-[#7C3AED] px-4 py-3 text-sm font-semibold text-white hover:bg-[#8B5CF6]"
      >
        Try again
      </button>
    </div>
  );
}
