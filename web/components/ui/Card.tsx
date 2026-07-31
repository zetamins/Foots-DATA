import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-500" strokeWidth={2} />
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
      {subtitle && <span className="text-xs text-neutral-400">{subtitle}</span>}
    </div>
  );
}
