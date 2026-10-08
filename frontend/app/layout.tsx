import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Auto Research Swarm",
  description: "Autonomous Multi-Agent Research Swarm Dashboard",
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
    >
      <body className="min-h-screen flex flex-col bg-[#FAFAFA] text-[#0A0A0A]">
        {/* Bauhaus Top Navigation Bar */}
        <header className="border-b-2 border-[#0A0A0A] bg-[#FAFAFA] sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="w-4 h-4 bg-[#E63946] inline-block" />
              <Link
                href="/"
                className="font-['Archivo_Black'] text-xl tracking-tight uppercase hover:text-[#E63946] transition-colors"
              >
                Auto Research Swarm
              </Link>
            </div>

            <nav className="flex items-center gap-6 font-['Space_Grotesk'] font-bold text-sm uppercase tracking-wide">
              <Link
                href="/"
                className="hover:text-[#E63946] transition-colors pb-1 border-b-2 border-transparent hover:border-[#E63946]"
              >
                Runs
              </Link>
              <Link
                href="/reviews"
                className="hover:text-[#E63946] transition-colors pb-1 border-b-2 border-transparent hover:border-[#E63946]"
              >
                Reviews
              </Link>
              <Link
                href="/knowledge"
                className="hover:text-[#E63946] transition-colors pb-1 border-b-2 border-transparent hover:border-[#E63946]"
              >
                Knowledge
              </Link>
              <Link
                href="/guardrails"
                className="hover:text-[#E63946] transition-colors pb-1 border-b-2 border-transparent hover:border-[#E63946]"
              >
                Guardrails
              </Link>
            </nav>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t-2 border-[#0A0A0A] bg-[#FAFAFA] py-6 px-4 sm:px-6 text-xs text-[#0A0A0A] font-mono">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2">
            <span>BAUHAUS AGENTIC CORE // 5-NODE SWARM</span>
            <span>FORM FOLLOWS FUNCTION</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
