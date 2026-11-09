import Link from "next/link";
import { Plus } from "lucide-react";
import { BrandMark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const WelcomePage = () => (
  <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6">
    <div className="dot-grid mask-fade pointer-events-none absolute inset-0 opacity-60" />
    <ThemeToggle className="absolute right-6 top-6" />

    <div className="relative flex w-full max-w-lg flex-col items-center text-center">
      <BrandMark className="size-12" />
      <h1 className="mt-8 text-4xl font-semibold tracking-tight">
        欢迎来到 ArchFlow
      </h1>
      <p className="mt-4 text-balance text-sm leading-7 text-muted-foreground">
        从一句模糊的 Idea 开始，让 AI 帮你推演并画出可落地的系统架构。
      </p>
      <Link
        href="/workspace"
        className="mt-9 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="size-4" strokeWidth={2} />
        创建你的第一个项目
      </Link>
      <p className="mt-5 text-[11px] text-muted-foreground">
        无需配置 · 从对话开始 · 随时导出
      </p>
    </div>

    <p className="absolute bottom-6 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
      ArchFlow · Constraint-driven architecture
    </p>
  </main>
);

export default WelcomePage;
