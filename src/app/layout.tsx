import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Serif, Outfit } from "next/font/google";
import "./globals.css";

// Display/UI does 80% of the work; serif is a change of register; mono is metadata.
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["300", "400", "500", "600"] });
const instrument = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "FRIDAY — your career agent", template: "%s · FRIDAY" },
  description: "SJSU on-campus jobs and Silicon Valley internships that actually match you — found, explained, and tracked by FRIDAY.",
  applicationName: "FRIDAY",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#100904" },
    { media: "(prefers-color-scheme: light)", color: "#f5f2ec" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Applies the saved theme before first paint (no flash). "system" = no attribute.
const themeScript = `try{var t=localStorage.getItem("friday-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${outfit.variable} ${instrument.variable} ${geistMono.variable} h-full`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="grain min-h-full">{children}</body>
    </html>
  );
}
