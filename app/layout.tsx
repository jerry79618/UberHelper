import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", base).toString();

  return {
    metadataBase: base,
    title: "UberHelper｜截圖，立刻決定",
    description:
      "上傳外送訂單截圖，在瀏覽器立即取得接單或不接的建議與原因。",
    applicationName: "UberHelper",
    icons: {
      icon: "/og.png",
      apple: "/og.png",
    },
    openGraph: {
      title: "UberHelper｜截圖，立刻決定",
      description: "辨識訂單收入、距離與目的地，立即給出接單建議。",
      type: "website",
      locale: "zh_TW",
      images: [{ url: socialImage, width: 1536, height: 1024 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "UberHelper｜截圖，立刻決定",
      description: "辨識訂單收入、距離與目的地，立即給出接單建議。",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}

