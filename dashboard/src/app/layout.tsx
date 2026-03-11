import type { Metadata } from "next";
export const metadata: Metadata = { title: "DevTracker", description: "Your personal activity dashboard" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body style={{margin:0,background:"#080b0f"}}>{children}</body></html>;
}
