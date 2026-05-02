import Link from "next/link";
import AboutContent from "@/components/AboutContent";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-page text-ink-100">
      <div className="mx-auto max-w-2xl px-4 pt-12 md:px-6 md:pt-16">
        <p className="text-sm text-ink-400">
          <Link
            href="/"
            className="text-accent-muted transition-colors hover:text-ink-100"
          >
            ← Back
          </Link>
        </p>
        <h1 className="mt-8 font-display text-3xl font-semibold text-ink-100">
          About
        </h1>
        <p className="mt-4 max-w-prose text-ink-400">
          WhatAptIsThis matches TikTok and Instagram tour clips to real listing
          signals — caption text for everyone, optional deeper scans for paid
          credits.
        </p>
      </div>
      <AboutContent />
    </div>
  );
}
