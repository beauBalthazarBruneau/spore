import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "Spore",
  icons: { icon: "/favicon.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="flex gap-4 px-6 py-3 border-b border-zinc-800 text-sm">
          <Link href="/swipe" className="hover:text-white">Swipe</Link>
          <Link href="/board" className="hover:text-white">Board</Link>
          <Link href="/companies" className="hover:text-white">Companies</Link>
          <Link href="/profile" className="hover:text-white">Profile</Link>
          <Link href="/stats" className="hover:text-white">Stats</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
