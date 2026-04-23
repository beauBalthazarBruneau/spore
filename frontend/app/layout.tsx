import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import ChatDrawer from "@/components/ChatDrawer";

export const metadata = {
  title: "Spore",
  icons: { icon: "/favicon.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="flex items-center px-6 py-3 border-b border-zinc-800 text-sm">
          <Link href="/" className="flex items-center gap-1.5 hover:text-white my-[-0.25rem]">
            <span className="text-xl leading-none">🍄</span>
            <span className="font-black tracking-tight lowercase text-xl leading-none">spore</span>
          </Link>
          <div className="ml-auto flex items-center gap-4">
            <Link href="/swipe" className="hover:text-white">Swipe</Link>
            <Link href="/board" className="hover:text-white">Board</Link>
            <Link href="/companies" className="hover:text-white">Companies</Link>
            <Link href="/profile" className="hover:text-white">Profile</Link>
            <Link href="/stats" className="hover:text-white">Stats</Link>
            <Link href="/funnel" className="hover:text-white">Funnel</Link>
          </div>
        </nav>
        <main>{children}</main>
        <ChatDrawer />
      </body>
    </html>
  );
}
