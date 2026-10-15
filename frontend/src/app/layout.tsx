import type { Metadata, Viewport } from "next";
import { Fraunces, Outfit } from "next/font/google";

import { Providers } from "@/components/providers";
import { PwaRuntime } from "@/components/pwa/pwa-runtime";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "BowlByte",
    template: "%s · BowlByte",
  },
  description:
    "Foundation for a college canteen: counter pickup, kitchen queues, and cash payments.",
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
  themeColor: "#1d6b64",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${outfit.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col text-foreground">
        <Providers>
          <a
            href="#content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-30 focus:rounded-full focus:bg-card focus:px-4 focus:py-2"
          >
            Skip to content
          </a>
          <PwaRuntime />
          <SiteHeader />
          <div id="content" className="flex-1">
            {children}
          </div>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
