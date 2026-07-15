/**
 * shadcn-style Badge.
 * Variants: default, secondary, outline, destructive.
 */
import * as React from "react";

import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "outline" | "destructive";

const base =
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";

const variantClasses: Record<Variant, string> = {
  default:
    "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
  secondary:
    "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
  outline: "text-foreground",
  destructive:
    "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(base, variantClasses[variant], className)}
      {...props}
    />
  );
}