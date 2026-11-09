import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArchFlow · 架构决策助手",
  description: "约束驱动的 AI 架构决策助手",
};

const themeScript = `(() => {
  try {
    const stored = window.localStorage.getItem("archflow-theme");
    const isDark = stored ? stored === "dark" : true;
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  } catch {
    document.documentElement.classList.add("dark");
  }
})();`;

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="zh-CN" className="dark" suppressHydrationWarning>
    <head>
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
    </head>
    <body className="min-h-dvh bg-background text-foreground antialiased">
      {children}
    </body>
  </html>
);

export default RootLayout;
