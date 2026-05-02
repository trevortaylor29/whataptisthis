import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WhatAptIsThis",
  description: "Find any apartment from a TikTok.",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "WhatAptIsThis",
    description: "Find any apartment from a TikTok.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${display.variable}`}>
      <body className="min-h-screen bg-page text-ink-100 font-sans antialiased">
        <div className="noise-overlay" aria-hidden />
        <div className="relative z-[1] min-h-screen">{children}</div>
      </body>
    </html>
  );
}
