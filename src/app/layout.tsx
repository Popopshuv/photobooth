import type { Metadata } from "next";
import { ClientShell } from "@/components/ClientShell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "group-d-system",
    template: "%s",
  },
  description:
    "Group Dynamics design system starter — minimal Next.js + GSAP + R3F template.",
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
