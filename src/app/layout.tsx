import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "@/components/app-shell";

export const metadata: Metadata = { title: "BrowserFlow", description: "Self-hosted visual browser automation" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="antialiased text-gray-900">
    <AppProviders>{children}</AppProviders>
  </body></html>;
}
