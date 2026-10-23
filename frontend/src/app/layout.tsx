import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Bricolage_Grotesque, Figtree, JetBrains_Mono } from "next/font/google";

import { Providers } from "@/components/providers";
import { PwaRuntime } from "@/components/pwa/pwa-runtime";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

import "./globals.css";

const body = Figtree({
  variable: "--font-body",
  subsets: ["latin"],
});

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "BowlByte",
    template: "%s · BowlByte",
  },
  description:
    "Foundation for a college canteen: order ahead, kitchen queues, and cash at the counter.",
  manifest: "/manifest.webmanifest",
  applicationName: "BowlByte",
  appleWebApp: { capable: true, title: "BowlByte", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0e0d12",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col text-foreground">
        <Providers>
          <a
            href="#content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-2"
          >
            Skip to content
          </a>
          <PwaRuntime />
          <Suspense
            fallback={
              <header className="sticky top-0 z-40 border-b border-white/5 bg-background/75 backdrop-blur-md">
                <div className="mx-auto flex w-full max-w-6xl items-center px-4 py-3 sm:px-6">
                  <span className="inline-flex min-h-11 items-center gap-2 font-display text-xl font-extrabold tracking-tight uppercase">
                    BowlByte
                  </span>
                </div>
              </header>
            }
          >
            <SiteHeader />
          </Suspense>
          <div id="content" className="flex-1">
            {children}
          </div>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
