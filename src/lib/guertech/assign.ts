import { DEFAULT_DURATIONS, isReactifOverdue } from "./constants";
import { compareScoreThenDistance, nearestStopKm } from "./geo";
import type { Appel, DayStop, Tech, Unassigned } from "./types";

export function parseMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export function onSiteMinutes(
  type: Appel["type"],
  durations = DEFAULT_DURATIONS,
): number {
  return type === "preventif" ? durations.preventif : durations.reactif;
}

function canDo(tech: Tech, appel: Appel): boolean {
  return tech.skills.includes(appel.equipementId);
}

function pickTech(
  present: Tech[],
  appel: Appel,
  capacity: Record<string, number>,
  assigned: Record<string, DayStop[]>,
  duration: number,
): Tech | null {
  const eligible = present.filter(
    (tech) => canDo(tech, appel) && capacity[tech.id] >= duration,
  );
  if (eligible.length === 0) return null;

  const scored = eligible.map((tech) => {
    const sameRegion = appel.region && tech.region === appel.region ? 2 : 0;
    const deuxPourUn =
      appel.type === "preventif" &&
      assigned[tech.id].some((stop) => stop.appel.type === "reactif")
        ? 3
        : 0;
    return {
      tech,
      score: sameRegion + deuxPourUn + capacity[tech.id] / 100,
      distanceKm: nearestStopKm(
        appel,
        assigned[tech.id].map((stop) => stop.appel),
      ),
    };
  });
  scored.sort(compareScoreThenDistance);
  return scored[0].tech;
}

function regionFirst(pool: Appel[], regions: Set<string>): Appel[] {
  return [
    ...pool.filter((item) => regions.has(item.region)),
    ...pool.filter((item) => !regions.has(item.region)),
  ];
}

export function assignDay(options: {
  calls: Appel[];
  techs: Tech[];
  pmQuota: number;
  asOfDate?: string;
  durations?: { preventif: number; reactif: number };
}): { byTech: Record<string, DayStop[]>; unassigned: Unassigned[] } {
  const durations = options.durations ?? DEFAULT_DURATIONS;
  const present = options.techs.filter((tech) => tech.present);
  const regions = new Set(
    present.map((tech) => tech.region.trim()).filter(Boolean),
  );
  const byTech: Record<string, DayStop[]> = Object.fromEntries(
    present.map((tech) => [tech.id, [] as DayStop[]]),
  );
  const unassigned: Unassigned[] = [];
  const capacity: Record<string, number> = {};
  for (const tech of present) {
    capacity[tech.id] = Math.max(
      60,
      parseMinutes(tech.endHour) - parseMinutes(tech.startHour),
    );
  }

  const push = (tech: Tech, appel: Appel, pinned: boolean) => {
    const minutes = onSiteMinutes(appel.type, durations);
    byTech[tech.id].push({
      appel: { ...appel, techId: tech.id },
      minutesOnSite: minutes,
      pinned,
    });
    capacity[tech.id] -= minutes;
  };

  const planned = [...options.calls.filter((item) => item.planifie)].sort(
    (a, b) => parseMinutes(a.heure || "99:00") - parseMinutes(b.heure || "99:00"),
  );
  const pinnedCount: Record<string, number> = {};

  for (const appel of planned) {
    if (!appel.heure) {
      unassigned.push({
        appel,
        reason: "Planifié : heure obligatoire (24 h)",
      });
      continue;
    }
    const tech =
      present.find((item) => item.id === appel.techId) ?? present[0] ?? null;
    if (!tech) {
      unassigned.push({ appel, reason: "Aucun technicien présent" });
      continue;
    }
    pinnedCount[tech.id] = (pinnedCount[tech.id] ?? 0) + 1;
    if (pinnedCount[tech.id] > 3) {
      unassigned.push({
        appel,
        reason: "Trop de rendez-vous planifiés sur ce technicien aujourd'hui",
      });
      continue;
    }
    push(tech, appel, true);
  }

  const reactifs = options.calls.filter(
    (item) => !item.planifie && item.type === "reactif",
  );
  const overdueFirst = [
    ...reactifs.filter((item) =>
      options.asOfDate ? isReactifOverdue(item, options.asOfDate) : false,
    ),
    ...reactifs.filter(
      (item) =>
        !(options.asOfDate ? isReactifOverdue(item, options.asOfDate) : false),
    ),
  ];
  const reactifToday = regionFirst(overdueFirst, regions).slice(
    0,
    Math.max(4, present.length * 2),
  );

  for (const appel of reactifToday) {
    const minutes = onSiteMinutes(appel.type, durations);
    const tech = pickTech(present, appel, capacity, byTech, minutes);
    if (!tech) {
      unassigned.push({
        appel,
        reason: "Aucune capacité ou compétence (réactif)",
      });
      continue;
    }
    push(tech, appel, false);
  }

  const preventifToday = regionFirst(
    options.calls.filter((item) => !item.planifie && item.type === "preventif"),
    regions,
  );

  /** Addresses already on today's routes (typically réactifs) — leave matching PM for suggestions. */
  const routedAddresses = new Set(
    Object.values(byTech)
      .flat()
      .map((stop) => stop.appel.adresse.trim().toLowerCase()),
  );

  let pmLeft = options.pmQuota;
  for (const appel of preventifToday) {
    if (pmLeft <= 0) break;
    if (routedAddresses.has(appel.adresse.trim().toLowerCase())) {
      // Dual client: same store already has a stop today → suggest in calendar instead.
      continue;
    }
    const minutes = onSiteMinutes(appel.type, durations);
    const tech = pickTech(present, appel, capacity, byTech, minutes);
    if (!tech) {
      unassigned.push({
        appel,
        reason: "Aucune capacité ou compétence (préventif)",
      });
      continue;
    }
    push(tech, appel, false);
    pmLeft -= 1;
  }

  return { byTech, unassigned };
}

export function mergePinnedAroundMovable(
  stops: DayStop[],
  movableOrderIds: string[],
  startHour: string,
  endHour: string,
): DayStop[] {
  const pinned = stops
    .filter((stop) => stop.pinned)
    .sort((a, b) => parseMinutes(a.appel.heure) - parseMinutes(b.appel.heure));
  const byId = new Map(stops.map((stop) => [stop.appel.id, stop]));
  const movable = movableOrderIds
    .map((id) => byId.get(id))
    .filter((stop): stop is DayStop => stop != null && !stop.pinned);

  const out: DayStop[] = [];
  let movableIndex = 0;
  let cursor = parseMinutes(startHour);
  const travelBuffer = 20;

  const fillUntil = (limit: number) => {
    while (movableIndex < movable.length) {
      const next = movable[movableIndex];
      if (!next) break;
      if (cursor + next.minutesOnSite + travelBuffer > limit) break;
      out.push(next);
      cursor += next.minutesOnSite + travelBuffer;
      movableIndex += 1;
    }
  };

  for (const pin of pinned) {
    fillUntil(parseMinutes(pin.appel.heure));
    out.push(pin);
    cursor =
      Math.max(cursor, parseMinutes(pin.appel.heure)) + pin.minutesOnSite;
  }
  fillUntil(parseMinutes(endHour));
  while (movableIndex < movable.length) {
    const leftover = movable[movableIndex];
    if (leftover) out.push(leftover);
    movableIndex += 1;
  }
  return out;
}
