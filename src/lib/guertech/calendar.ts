const WEEKDAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."] as const;
const MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
] as const;

export function parseIso(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

export function formatIso(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `days` jours ouvrables après `iso`, sans compter `iso`. */
export function addBusinessDays(iso: string, days: number): string {
  const cursor = parseIso(iso);
  if (Number.isNaN(cursor.getTime())) return iso;
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return formatIso(cursor);
}

/** Jours ouvrables à partir de `iso` inclus. Un samedi ou un dimanche avance au lundi. */
export function workingDaysFrom(iso: string, count: number): string[] {
  const cursor = parseIso(iso);
  if (Number.isNaN(cursor.getTime()) || count <= 0) return [];
  const out: string[] = [];
  while (out.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) out.push(formatIso(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function formatDayLabel(iso: string): string {
  const date = parseIso(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function formatHoursFr(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours <= 0) return `${mins} min`;
  if (mins === 0) return `${hours} h`;
  return `${hours} h ${mins} min`;
}

export function formatKmFr(km: number): string {
  if (!Number.isFinite(km) || km <= 0) return "0 km";
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
