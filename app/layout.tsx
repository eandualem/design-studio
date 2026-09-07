import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "sonner";
import { Providers } from "./providers";
import { LayoutShell } from "@/components/layout/layout-shell";
import { THEME_BOOT_SCRIPT } from "@/lib/prefs";
import "./globals.css";

const inter = localFont({
  src: "../public/fonts/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  display: "swap",
});
const jetbrains = localFont({
  src: "../public/fonts/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Design Studio",
  description: "Markdown and Mermaid design documents with an assistant",
};

export const viewport: Viewport = {
  themeColor: "#1e2127",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${inter.variable} ${jetbrains.variable} h-full font-sans antialiased`}>
        <Providers>
          <LayoutShell>{children}</LayoutShell>
        </Providers>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
