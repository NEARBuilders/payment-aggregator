import { cn } from "@/lib/utils";

type Variant = "narrow" | "default" | "wide";

const widths: Record<Variant, string> = {
  narrow: "max-w-2xl",
  default: "max-w-4xl",
  wide: "max-w-6xl",
};

export function PageContainer({
  variant = "default",
  className,
  children,
}: {
  variant?: Variant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6 py-6 sm:py-10", widths[variant], className)}>
      {children}
    </div>
  );
}
