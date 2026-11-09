import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = ({ className, ...props }: InputProps) => (
  <input
    className={cn(
      "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground focus:ring-1 focus:ring-foreground/15 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
);

export { Input };
export type { InputProps };
