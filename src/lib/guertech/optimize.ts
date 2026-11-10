import { parseMinutes, onSiteMinutes } from "./assign";
import { DEFAULT_DURATIONS, isReactifOverdue } from "./constants";
import type { Appel, DayStop, Tech, TechRoute, Unassigned } from "./types";

/** Soft road window: techs should be off the road by 17:00 (8–5). Soft = warn + ignore. */
export const ROAD_WINDOW = {
  start: "08:00",
  softEnd: "17:00",
  softEndLabel: "17:00",
  defaultTravel: 20,
  returnTravel: 25,
} as const;

export type OvertimeWarning = {
  techId: string;
  techName: string;
  finishMin: number;
  finishLabel: string;
  softEndMin: number;
  overtimeMin: number;
  source: "estimate" | "google";
};

export type OptimizeDayResult = {
  byTech: Record<string, DayStop[]>;
  unassigned: Unassigned[];
  /** Planifiés / overdue that already push past soft end before Google. */
  earlyWarnings: OvertimeWarning[];
};

function formatClock(total: number): string {
  const hours = Math.floor(Math.max(0, total) / 60);
  const minutes = Math.max(0, total) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function canDo(tech: Tech, appel: Appel): boolean {
  return tech.skills.includes(appel.equipementId);
}

function softEndFor(tech: Tech): number {
  return Math.min(
    parseMinutes(tech.endHour || ROAD_WINDOW.softEnd),
    parseMinutes(ROAD_WINDOW.softEnd),
  );
}

function regionFirst(pool: Appel[], regions: Set<string>): Appel[] {
  return [
    ...pool.filter((item) => regions.has(item.region)),
    ...pool.filter((item) => !regions.has(item.region)),
  ];
}

/**
 * Estimate when the tech finishes the last job + return to dépôt (soft window check).
 */
export function estimateFinishMin(
  tech: Tech,
  stops: DayStop[],
  google?: TechRoute["google"],
): { finishMin: number; source: "estimate" | "google" } {
  if (stops.length === 0) {
    return {
      finishMin: parseMinutes(tech.startHour || ROAD_WINDOW.start),
      source: "estimate",
    };
  }

  if (google?.optimizedStopDetails?.length) {
    const last = google.optimizedStopDetails[google.optimizedStopDetails.length - 1];
    const leaveMatch = last?.leaveLabel?.match(/(\d{1,2}):(\d{2})/);
    let leaveMin = parseMinutes(tech.startHour || ROAD_WINDOW.start);
    if (leaveMatch) {
      leaveMin = Number(leaveMatch[1]) * 60 + Number(leaveMatch[2]);
    }
    const returnLeg = google.legs?.[stops.length];
    const returnMin = returnLeg
      ? Math.max(5, Math.round(returnLeg.durationSeconds / 60))
      : ROAD_WINDOW.returnTravel;
    return { finishMin: leaveMin + returnMin, source: "google" };
  }

  let cursor = parseMinutes(tech.startHour || ROAD_WINDOW.start);
  for (const stop of stops) {
    cursor += ROAD_WINDOW.defaultTravel;
    if (stop.pinned && stop.appel.heure) {
      cursor = Math.max(cursor, parseMinutes(stop.appel.heure));
    }
    cursor += stop.minutesOnSite;
  }
  cursor += ROAD_WINDOW.returnTravel;
  return { finishMin: cursor, source: "estimate" };
}

export function evaluateRoadWindow(routes: TechRoute[]): OvertimeWarning[] {
  const soft = parseMinutes(ROAD_WINDOW.softEnd);
  const warnings: OvertimeWarning[] = [];

  for (const route of routes) {
    if (route.stops.length === 0) continue;
    const { finishMin, source } = estimateFinishMin(
      route.tech,
      route.stops,
      route.google,
    );
    if (finishMin <= soft) continue;
    warnings.push({
      techId: route.tech.id,
      techName: route.tech.name,
      finishMin,
      finishLabel: formatClock(finishMin),
      softEndMin: soft,
      overtimeMin: finishMin - soft,
      source,
    });
  }

  return warnings.sort((a, b) => b.overtimeMin - a.overtimeMin);
}

/**
 * Drop trailing non-pinned stops until estimated finish fits the soft window.
 * Planifiés are never removed.
 */
export function trimToSoftEnd(
  tech: Tech,
  stops: DayStop[],
): { stops: DayStop[]; removed: DayStop[] } {
  const soft = softEndFor(tech);
  const current = [...stops];
  const removed: DayStop[] = [];

  while (current.length > 0) {
    const { finishMin } = estimateFinishMin(tech, current);
    if (finishMin <= soft) break;
    let dropIndex = -1;
    for (let i = current.length - 1; i >= 0; i -= 1) {
      if (!current[i]?.pinned) {
        dropIndex = i;
        break;
      }
    }
    if (dropIndex < 0) break;
    const [dropped] = current.splice(dropIndex, 1);
    if (dropped) removed.push(dropped);
  }

  return { stops: current, removed };
}

function pickTech(
  present: Tech[],
  appel: Appel,
  capacity: Record<string, number>,
  assigned: Record<string, DayStop[]>,
  duration: number,
  force: boolean,
): Tech | null {
  const eligible = present.filter((tech) => {
    if (!canDo(tech, appel)) return false;
    if (force) return true;
    return capacity[tech.id] >= duration + ROAD_WINDOW.defaultTravel;
  });
  if (eligible.length === 0) return null;

  const scored = eligible.map((tech) => {
    const sameRegion = tech.region === appel.region ? 4 : 0;
    const dual =
      appel.type === "preventif" &&
      assigned[tech.id].some(
        (stop) =>
          stop.appel.adresse.trim().toLowerCase() ===
          appel.adresse.trim().toLowerCase(),
      )
        ? 8
        : 0;
    const hasReactif = assigned[tech.id].some((s) => s.appel.type === "reactif")
      ? 2
      : 0;
    const loadBalance = capacity[tech.id] / 50;
    const lessCrowded = 1 / (1 + assigned[tech.id].length);
    return {
      tech,
      score: sameRegion + dual + hasReactif + loadBalance + lessCrowded,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.tech ?? null;
}

/**
 * Optimal day pack under the 8–5 soft road window.
 * Priority: planifiés → réactifs délai dépassé → réactifs → préventifs (quota).
 * Stops that would push past 17:00 are left unassigned unless `allowOvertime`.
 */
export function optimizeDay(options: {
  calls: Appel[];
  techs: Tech[];
  pmQuota: number;
  asOfDate?: string;
  durations?: { preventif: number; reactif: number };
  allowOvertime?: boolean;
}): OptimizeDayResult {
  const durations = options.durations ?? DEFAULT_DURATIONS;
  const allowOvertime = options.allowOvertime ?? false;
  const present = options.techs.filter((tech) => tech.present);
  const regions = new Set(present.map((tech) => tech.region));
  const byTech: Record<string, DayStop[]> = Object.fromEntries(
    present.map((tech) => [tech.id, [] as DayStop[]]),
  );
  const unassigned: Unassigned[] = [];
  const earlyWarnings: OvertimeWarning[] = [];

  const capacity: Record<string, number> = {};
  for (const tech of present) {
    const start = parseMinutes(tech.startHour || ROAD_WINDOW.start);
    const end = softEndFor(tech);
    capacity[tech.id] = Math.max(60, end - start - ROAD_WINDOW.returnTravel);
  }

  const fitsSoft = (tech: Tech, extraMin: number): boolean => {
    if (allowOvertime) return true;
    const { finishMin } = estimateFinishMin(tech, [
      ...byTech[tech.id],
      {
        appel: {
          id: "_probe",
          type: "preventif",
          magasin: "",
          adresse: "",
          ville: "",
          region: "",
          equipement: "",
          equipementId: 0,
          netsuiteId: "",
          planifie: false,
          heure: "",
          techId: tech.id,
          openedAt: "",
        },
        minutesOnSite: extraMin,
        pinned: false,
      },
    ]);
    return finishMin <= softEndFor(tech);
  };

  const push = (tech: Tech, appel: Appel, pinned: boolean) => {
    const minutes = onSiteMinutes(appel.type, durations);
    byTech[tech.id].push({
      appel: { ...appel, techId: tech.id },
      minutesOnSite: minutes,
      pinned,
    });
    capacity[tech.id] -= minutes + ROAD_WINDOW.defaultTravel;
  };

  // 1) Planifiés (hard pins)
  const planned = [...options.calls.filter((item) => item.planifie)].sort(
    (a, b) =>
      parseMinutes(a.heure || "99:00") - parseMinutes(b.heure || "99:00"),
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

  // 2) Réactifs — overdue first (may force soft overtime → early warning)
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
  const reactifToday = regionFirst(overdueFirst, regions);

  for (const appel of reactifToday) {
    const minutes = onSiteMinutes(appel.type, durations);
    const isOverdue = options.asOfDate
      ? isReactifOverdue(appel, options.asOfDate)
      : false;
    const tech = pickTech(
      present,
      appel,
      capacity,
      byTech,
      minutes,
      isOverdue || allowOvertime,
    );
    if (!tech) {
      unassigned.push({
        appel,
        reason: "Aucune capacité ou compétence (réactif)",
      });
      continue;
    }
    if (!isOverdue && !fitsSoft(tech, minutes)) {
      unassigned.push({
        appel,
        reason: `Hors fenêtre 8 h–${ROAD_WINDOW.softEndLabel} (route trop pleine)`,
      });
      continue;
    }
    push(tech, appel, false);
  }

  // 3) Préventifs (quota) — never auto-assign dual-client matches; skip if over soft end
  const preventifToday = regionFirst(
    options.calls.filter((item) => !item.planifie && item.type === "preventif"),
    regions,
  );
  const routedAddresses = new Set(
    Object.values(byTech)
      .flat()
      .map((stop) => stop.appel.adresse.trim().toLowerCase()),
  );

  let pmLeft = options.pmQuota;
  for (const appel of preventifToday) {
    if (pmLeft <= 0) break;
    if (routedAddresses.has(appel.adresse.trim().toLowerCase())) continue;

    const minutes = onSiteMinutes(appel.type, durations);
    const tech = pickTech(
      present,
      appel,
      capacity,
      byTech,
      minutes,
      allowOvertime,
    );
    if (!tech) {
      unassigned.push({
        appel,
        reason: "Aucune capacité ou compétence (préventif)",
      });
      continue;
    }
    if (!fitsSoft(tech, minutes)) {
      unassigned.push({
        appel,
        reason: `Ne rentre pas avant ${ROAD_WINDOW.softEndLabel}`,
      });
      continue;
    }
    push(tech, appel, false);
    pmLeft -= 1;
  }

  // Early soft-window check after packing
  for (const tech of present) {
    const stops = byTech[tech.id] ?? [];
    if (stops.length === 0) continue;
    const { finishMin, source } = estimateFinishMin(tech, stops);
    const soft = softEndFor(tech);
    if (finishMin > soft) {
      earlyWarnings.push({
        techId: tech.id,
        techName: tech.name,
        finishMin,
        finishLabel: formatClock(finishMin),
        softEndMin: soft,
        overtimeMin: finishMin - soft,
        source,
      });
    }
  }

  return { byTech, unassigned, earlyWarnings };
}

/**
 * Merge pinned + movable without dumping leftovers past soft end (unless allowed).
 */
export function mergePinnedOptimal(
  stops: DayStop[],
  movableOrderIds: string[],
  startHour: string,
  softEndHour: string,
  allowOvertime = false,
): { ordered: DayStop[]; leftover: DayStop[] } {
  const pinned = stops
    .filter((stop) => stop.pinned)
    .sort((a, b) => parseMinutes(a.appel.heure) - parseMinutes(b.appel.heure));
  const byId = new Map(stops.map((stop) => [stop.appel.id, stop]));
  const movable = movableOrderIds
    .map((id) => byId.get(id))
    .filter((stop): stop is DayStop => stop != null && !stop.pinned);

  const out: DayStop[] = [];
  const leftover: DayStop[] = [];
  let movableIndex = 0;
  let cursor = parseMinutes(startHour);
  const travelBuffer = ROAD_WINDOW.defaultTravel;
  const softEnd = parseMinutes(softEndHour);

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
  fillUntil(softEnd - ROAD_WINDOW.returnTravel);

  while (movableIndex < movable.length) {
    const item = movable[movableIndex];
    movableIndex += 1;
    if (!item) continue;
    if (allowOvertime) out.push(item);
    else leftover.push(item);
  }

  return { ordered: out, leftover };
}
