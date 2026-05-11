import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scorpion → WordPress Converter",
  description: "Convert Scorpion CMS sites into WordPress sites",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
