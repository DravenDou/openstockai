import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./globals.css";
import { Toaster } from "@/shared/ui/sonner";
import { AuthGate } from "@/shell/auth-gate";

export const metadata: Metadata = {
  title: "OpenStock AI — Your stock, one conversation away.",
  description: "Manage your inventory, stock movements and purchases from a single conversation.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthGate>{children}</AuthGate>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
