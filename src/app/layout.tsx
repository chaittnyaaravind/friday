import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Serif, Outfit } from "next/font/google";
import "./globals.css";

// Display/UI does 80% of the work; serif is a change of register; mono is metadata.
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["300", "400", "500", "600"] });
const instrument = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "FRIDAY — the SJSU job hunter", template: "%s · FRIDAY" },
  description: "FRIDAY hunts SJSU on-campus jobs for San José State students: checked every minute, ranked against you, resume tailored, sent to Telegram.",
  applicationName: "FRIDAY",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0c08" },
    { media: "(prefers-color-scheme: light)", color: "#f2ede2" },
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
