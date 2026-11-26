import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Instrument_Serif, Geist_Mono } from "next/font/google";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "../lib/theme-boot";

// Same faces as yaaralabs.ai: Hanken Grotesk for UI, Instrument Serif for headlines.
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "YaaraLabs Playground",
    template: "%s · YaaraLabs Playground",
  },
  description:
    "Hands-on AI fluency labs by YaaraLabs. Collect data, train models and build AI into real workflows, practitioner-built and use-case-led.",
  icons: {
    icon: "/brand/yaaralabs-mark.svg",
    apple: "/brand/yaaralabs-mark.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#120a18" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Font variables live on <html> so the :root theme (--font-sans) can resolve them
    <html lang="en" className={`${hanken.variable} ${instrument.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint (no dark/light flash) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body
        className="antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
