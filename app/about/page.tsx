import type { Metadata } from "next";
import Link from "next/link";
import AboutContent from "@/components/AboutContent";

export const metadata: Metadata = {
  title: "How it Works",
  description:
    "WhatAptIsThis matches TikTok and Instagram tour clips to real listing signals — caption text for everyone, optional deeper scans for paid credits.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-page text-ink-100">
      <div className="mx-auto max-w-5xl px-4 md:px-8">
        <header className="border-b border-[#1E1E2E] pb-10 pt-12 md:pb-12 md:pt-16">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-400 transition-colors hover:text-ink-100"
          >
            <span aria-hidden className="text-base leading-none">
              ←
            </span>
            Back to home
          </Link>
          <h1 className="mt-8 font-display text-3xl font-semibold tracking-tight text-ink-100 md:text-4xl">
            How it Works
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-400 md:text-lg">
            WhatAptIsThis matches TikTok and Instagram tour clips to real listing
            signals — caption text for everyone, optional deeper scans for paid
            credits.
          </p>
        </header>
      </div>
      <AboutContent />
    </div>
  );
}
