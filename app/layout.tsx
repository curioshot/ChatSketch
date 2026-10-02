import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChatSketch",
  description: "Chat it. Sketch it. Draw with AI on a shared board.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-screen w-full bg-white text-black">
        {children}
      </body>
    </html>
  );
}
