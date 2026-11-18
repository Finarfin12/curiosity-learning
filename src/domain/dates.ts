export function localDate(date = new Date()): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(value => String(value).padStart(2, "0")).join("-");
}

const day = 86_400_000;
const midnight = (date: string) => Date.parse(date + "T00:00:00Z");

export function elapsedDays(from: string, to: string): number {
  return Math.max(0, (midnight(to) - midnight(from)) / day);
}

export function addDays(date: string, days: number): string {
  return new Date(midnight(date) + days * day).toISOString().slice(0, 10);
}

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(midnight(value)) && addDays(value, 0) === value;
}
