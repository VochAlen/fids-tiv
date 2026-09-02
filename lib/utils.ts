
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: (string | undefined | null | false)[]): string {
  return twMerge(clsx(inputs));
}
/**
 * Gets the display time for a flight (prioritizes estimated over scheduled)
 */
export function getDisplayTime(estimatedTime: string, scheduledTime: string): string {
  return estimatedTime || scheduledTime || '--:--';
}

/**
 * Returns status color class based on flight status
 */
export function getStatusColor(status: string): string {
  const statusLower = status.toLowerCase();
  
  if (statusLower.includes('delay') || statusLower.includes('cancel')) {
    return 'text-red-400';
  }
  
  if (statusLower.includes('boarding') || statusLower.includes('departed') || 
      statusLower.includes('arrived') || statusLower.includes('landed')) {
    return 'text-green-400';
  }
  
  if (statusLower.includes('on time') || statusLower.includes('scheduled')) {
    return 'text-yellow-400';
  }
  
  return 'text-slate-400';
}