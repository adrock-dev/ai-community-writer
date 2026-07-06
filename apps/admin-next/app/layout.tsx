import type { Metadata } from "next";
import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Adrock Content Ops",
  description: "Internal content operations UI for Adrock",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Suspense fallback={<main className="main"><div className="card card-pad gate-card">로딩 중...</div></main>}>
          <AppShell apiBase={process.env.SEO_API_BASE_URL ?? "http://127.0.0.1:8765"}>
            {children}
          </AppShell>
        </Suspense>
      </body>
    </html>
  );
}
