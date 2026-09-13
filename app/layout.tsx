import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Baslon OS",
  description: "Strategic decision support grounded in evidence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
