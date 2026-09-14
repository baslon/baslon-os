import type { Metadata } from "next";
import "./styles.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Baslon OS",
  description: "Strategic decision support grounded in evidence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <div className="app-header-inner">
            <Link className="brand" href="/">Baslon OS</Link>
            <nav aria-label="Primary navigation"><Link href="/">Home</Link><Link href="/businesses">Businesses</Link></nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
