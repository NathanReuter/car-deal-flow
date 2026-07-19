import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Car Deal Flow",
  description: "Decision-support system for safe used-car purchases in Brazil.",
};

// Applies the persisted theme before hydration to avoid a light/dark flash.
const THEME_INIT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('cdf-theme');
    var dark = stored ? stored === 'dark' : false;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script id="theme-init" strategy="beforeInteractive">{THEME_INIT_SCRIPT}</Script>
      </head>
      <body className="min-h-full bg-background font-sans text-text-primary">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileNav />
            <main id="main-content" className="flex-1 overflow-y-auto" tabIndex={-1}>
              <div className="mx-auto max-w-[1400px] p-4 sm:p-5 lg:p-6">{children}</div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
