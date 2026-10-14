import type { Metadata } from "next";
import { Fraunces, Outfit } from "next/font/google";

import { Providers } from "@/components/providers";
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
