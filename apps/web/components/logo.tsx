import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  tone?: "auto" | "light" | "dark";
};

const Sparkle = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M11.6 2.4c.44 4.9 1.94 7.1 6.9 8-4.96.9-6.46 3.1-6.9 8-.44-4.9-1.94-7.1-6.9-8 4.96-.9 6.46-3.1 6.9-8Z"
      fill="currentColor"
    />
    <path
      d="M18.9 14.1c.22 2.4.94 3.46 3.35 3.9-2.41.44-3.13 1.5-3.35 3.9-.22-2.4-.94-3.46-3.35-3.9 2.41-.44 3.13-1.5 3.35-3.9Z"
      fill="currentColor"
      opacity="0.62"
    />
  </svg>
);

const BrandMark = ({ className, tone = "auto" }: BrandMarkProps) => (
  <span
    className={cn(
      "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
      tone === "light" && "bg-white text-[#0a0a0a]",
      tone === "dark" && "bg-[#0a0a0a] text-white",
      tone === "auto" && "bg-foreground text-background",
      className,
    )}
  >
    <Sparkle className="size-1/2" />
  </span>
);

export { BrandMark };
export type { BrandMarkProps };
