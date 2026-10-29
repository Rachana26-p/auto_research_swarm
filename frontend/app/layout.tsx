import type { Metadata } from "next";
import React, { Suspense } from "react";
import { Archivo_Black, Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const fontDisplay = Archivo_Black({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});

const fontHeading = Space_Grotesk({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-heading",
});

const fontBody = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-body",
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-mono",
});

import {
  CookieConsent,
  GeminiSidebar,
  Navbar,
  OutageBanner,
  ScrollProgressBar,
  ThemeProvider,
  UtmTracker,
} from "@/components";

export const metadata: Metadata = {
  title: "Auto Research Swarm | Autonomous Multi-Agent Academic Synthesis",
  description: "Autonomous 5-node research swarm coordinating literature discovery, structured extraction, validation guardrails, and Overleaf-ready LaTeX synthesis.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://autoresearchswarm.com"),
  openGraph: {
    title: "Auto Research Swarm",
    description: "Multi-agent autonomous research and LaTeX survey synthesis platform.",
    url: "https://autoresearchswarm.com",
    siteName: "Auto Research Swarm",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Auto Research Swarm",
    description: "Autonomous multi-agent academic research swarm dashboard.",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fontDisplay.variable} ${fontHeading.variable} ${fontBody.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen flex flex-col bg-[#FAFAFA] text-[#0A0A0A] dark:bg-[#0C0D12] dark:text-[#EDEEF2] transition-colors">
        {/* Accessible Skip to Content Link */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[99999] focus:px-4 focus:py-2 focus:bg-[#E63946] focus:text-[#FAFAFA] focus:font-['Space_Grotesk'] focus:font-bold focus:text-xs focus:uppercase focus:shadow-[3px_3px_0px_0px_#0A0A0A] focus:outline-none"
        >
          Skip to main content &darr;
        </a>

        {/* Global Reading Scroll Progress Indicator */}
        <ScrollProgressBar />

        {/* Marketing Attribution / Campaign UTM Tracker */}
        <UtmTracker />

        <ThemeProvider>
          {/* Global Database Outage Banner (WS0 Resilience) */}
          <OutageBanner />

          {/* Top Navigation Bar */}
          <Suspense fallback={<div className="h-16 border-b-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#101217]" />}>
            <Navbar />
          </Suspense>

          {/* Workspace Layout: Sidebar + Main Content */}
          <div className="flex-1 flex w-full">
            <Suspense fallback={null}>
              <GeminiSidebar />
            </Suspense>
            <main
              id="main-content"
              tabIndex={-1}
              className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 min-w-0 focus:outline-none"
            >
              {children}
            </main>
          </div>

          {/* Global Cookie Consent Banner */}
          <CookieConsent />

          {/* Footer with Compliance & Policy Links */}
          <footer className="border-t-2 border-[#0A0A0A] dark:border-[#2C3142] bg-[#FAFAFA] dark:bg-[#101217] py-6 px-4 sm:px-6 text-xs text-[#0A0A0A] dark:text-[#EDEEF2] font-mono shrink-0 transition-colors">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
            <div className="flex items-center gap-4">
              <span>AUTONOMOUS RESEARCH SWARM // 5-NODE GRAPH</span>
              <span>&bull;</span>
              <Link href="/privacy" className="underline hover:text-[#E63946] dark:hover:text-[#FF5C6C]">
                Privacy Policy
              </Link>
              <Link href="/terms" className="underline hover:text-[#E63946] dark:hover:text-[#FF5C6C]">
                Terms &amp; Conditions
              </Link>
            </div>
            <span>AUTONOMOUS ACADEMIC SYNTHESIS</span>
          </div>
        </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
