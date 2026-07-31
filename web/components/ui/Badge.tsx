export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const toneClasses = {
    neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
    warn: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
    bad: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses}`}>{children}</span>;
}
