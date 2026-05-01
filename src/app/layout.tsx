import type { Metadata } from "next";
import { ClientShell } from "@/components/ClientShell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "photobooth — group dynamics",
    template: "%s",
  },
  description: "Group Dynamics photobooth — Salt Lake City, UT.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
