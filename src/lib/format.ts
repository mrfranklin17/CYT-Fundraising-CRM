const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return currency.format(value);
}

/** Signed, for surplus/deficit lines where the sign is the point. */
export function signedMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const formatted = currency.format(Math.abs(value));
  return value < 0 ? `−${formatted}` : formatted;
}

export function amountRange(
  min: number | null | undefined,
  max: number | null | undefined,
): string {
  if (min == null && max == null) return "Amount not recorded";
  if (min != null && max != null) return `${money(min)} – ${money(max)}`;
  return money(min ?? max);
}

/** Dates arrive as `YYYY-MM-DD`. Parse as local noon so no timezone shifts it. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function formatDate(value: string | null | undefined): string {
  const date = parseDateOnly(value);
  if (!date) return "No date";
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShortDate(value: string | null | undefined): string {
  const date = parseDateOnly(value);
  if (!date) return "No date";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function daysUntil(value: string | null | undefined): number | null {
  const date = parseDateOnly(value);
  if (!date) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return Math.round((date.getTime() - start.getTime()) / 86_400_000);
}

export type Urgency = "past" | "now" | "soon" | "later" | "none";

/** Drives the left color bar on every opportunity strip. */
export function urgencyOf(deadline: string | null | undefined): Urgency {
  const days = daysUntil(deadline);
  if (days === null) return "none";
  if (days < 0) return "past";
  if (days <= 14) return "now";
  if (days <= 45) return "soon";
  return "later";
}

export function countdownLabel(deadline: string | null | undefined): string {
  const days = daysUntil(deadline);
  if (days === null) return "No deadline recorded";
  if (days === 0) return "Due today";
  if (days === 1) return "1 day left";
  if (days < 0) {
    const past = Math.abs(days);
    return past === 1 ? "1 day past" : `${past} days past`;
  }
  return `${days} days left`;
}

export function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
