/**
 * `cn` — class-name composer.
 *
 * Combines class names with tailwind-merge so later utility classes
 * override earlier ones. Used by every shadcn-style component in
 * components/ui/*.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}