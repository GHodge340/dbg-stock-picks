import type { Metadata } from "next";
import "./globals.css";
import AutoRefresh from "@/components/AutoRefresh";

export const metadata: Metadata = {
  title: "DBG Stock Picks | AI Stock Analysis",
  description: "AI-Generated stock swing trading candidates.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-950">
        <AutoRefresh />
        {children}
      </body>
    </html>
  );
}
