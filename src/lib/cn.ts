/**
 * Wend — className merge helper. clsx for conditional joins + tailwind-merge to
 * resolve conflicting Tailwind utilities (last-wins). Used by every primitive.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
