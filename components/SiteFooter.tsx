"use client";

import Link from "next/link";
import Logo from "./Logo";

export default function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[#1E1E2E] bg-ink-900 py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 md:px-8">
        <div className="flex flex-col gap-2">
          <Logo compact />
          <p className="max-w-md text-sm text-ink-400">
            Built for apartment hunters tired of DMing agents.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <Link
            href="/about"
            className="text-accent-muted transition-colors hover:text-ink-100"
          >
            How it Works
          </Link>
          <Link
            href="/contact"
            className="text-accent-muted transition-colors hover:text-ink-100"
          >
            Contact
          </Link>
          <Link
            href="/legal"
            className="text-accent-muted transition-colors hover:text-ink-100"
          >
            Legal
          </Link>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("apt-open-restore"))
            }
            className="text-accent-muted transition-colors hover:text-ink-100"
          >
            Restore purchases
          </button>
        </nav>
        <p className="text-xs text-ink-500">© 2026 WhatAptIsThis</p>
      </div>
    </footer>
  );
}
