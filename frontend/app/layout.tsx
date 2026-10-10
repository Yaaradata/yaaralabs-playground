import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "../lib/theme-boot";

// Inter matches yaaralabs.ai
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
    icon: "/yaaralogo.jpg",
    apple: "/yaaralogo.jpg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#010101" },
    { media: "(prefers-color-scheme: light)", color: "#f7f5fa" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Font variables live on <html> so the :root theme (--font-sans) can resolve them
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`} suppressHydrationWarning>
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
