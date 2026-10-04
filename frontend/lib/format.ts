import { DAY, HOUR } from "./engine/forget";

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

export const fmt2 = (x: number) => x.toFixed(2);

export function compact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString("en-IN");
}

export function relTime(t: number, now: number): string {
  const d = now - t;
  const abs = Math.abs(d);
  const future = d < 0;
  let s: string;
  if (abs < 45_000) return future ? "in a moment" : "just now";
  if (abs < HOUR) s = `${Math.round(abs / 60_000)} min`;
  else if (abs < DAY) s = `${Math.round(abs / HOUR)} h`;
  else if (abs < 30 * DAY) s = `${Math.round(abs / DAY)} d`;
  else s = `${Math.round(abs / (30 * DAY))} mo`;
  return future ? `in ${s}` : `${s} ago`;
}

export function day(t: number): string {
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function dayYear(t: number): string {
  return new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function isoDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function clock(t: number): string {
  return new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function weekdayClock(t: number): { day: string; time: string } {
  const d = new Date(t);
  return {
    day: d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }),
    time: d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
  };
}

export function untilText(t: number, now: number): string {
  const d = t - now;
  if (d <= 0) return "expired";
  if (d < HOUR) return `${Math.max(1, Math.round(d / 60_000))} min left`;
  if (d < DAY) return `${Math.round(d / HOUR)} h left`;
  return `${Math.round(d / DAY)} d left`;
}

export function signed(x: number, digits = 2): string {
  const v = x.toFixed(digits);
  return x > 0 ? `+${v}` : x < 0 ? v.replace("-", "−") : `±${v}`;
}
