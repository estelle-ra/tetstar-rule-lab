import type { Metadata } from "next";
import "./globals.css";

const siteUrl = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000/",
);
const title = "TETRIX Rule Lab — Modern Stacker";
const description =
  "싱글 기록전과 최대 8개 기기의 실시간 온라인 룸을 지원하는 오리지널 브라우저 블록 스태커.";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title,
  description,
  openGraph: {
    description,
    title,
    type: "website",
    images: [{ url: new URL("og.png", siteUrl), width: 1664, height: 948 }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [new URL("og.png", siteUrl)],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
