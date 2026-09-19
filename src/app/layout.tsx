import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "谜局 · AI 剧本杀主持台",
  description: "导入剧本、审核规则，与朋友异地开局。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
