const YOCTO_PER_NEAR = 10n ** 24n;

export function yoctoToNear(yocto: string): string {
  const value = BigInt(yocto);
  const whole = value / YOCTO_PER_NEAR;
  const fraction = (value % YOCTO_PER_NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function nearToYocto(near: string): bigint | null {
  const trimmed = near.trim();
  if (!trimmed) return null;
  const [whole = "", fraction = ""] = trimmed.split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > 24) return null;
  if (!whole && !fraction) return null;
  return BigInt(whole || "0") * YOCTO_PER_NEAR + BigInt(fraction.padEnd(24, "0") || "0");
}

export function formatPlanAmount(amount: string, currency: string): string {
  if (currency === "NEAR") return `${yoctoToNear(amount)} NEAR`;
  if (currency === "USD") return `$${(Number(amount) / 100).toFixed(2)}`;
  return `${amount} ${currency}`;
}

export function formatPlanRange(minAmount: string, maxAmount: string, currency: string): string {
  if (minAmount === maxAmount) return formatPlanAmount(minAmount, currency);
  if (currency === "NEAR") return `${yoctoToNear(minAmount)}–${yoctoToNear(maxAmount)} NEAR`;
  return `${formatPlanAmount(minAmount, currency)}–${formatPlanAmount(maxAmount, currency)}`;
}
