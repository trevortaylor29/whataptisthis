import Link from "next/link";

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
    <div className="mx-auto max-w-2xl px-4 py-16 md:px-6">
      <p className="text-sm text-ink-400">
        <Link href="/" className="text-accent-muted hover:text-ink-100">
          ← Back
        </Link>
      </p>
      <h1 className="mt-8 font-display text-3xl font-semibold text-ink-100">
        Contact
      </h1>
      <p className="mt-4 text-ink-400">
        A contact form or email will land here soon.
      </p>
    </div>
    </div>
  );
}
