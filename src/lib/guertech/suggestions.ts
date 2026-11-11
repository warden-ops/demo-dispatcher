import { onSiteMinutes, parseMinutes } from "./assign";
import { DEFAULT_DURATIONS } from "./constants";
import { compareScoreThenDistance, nearestStopKm } from "./geo";
import { ROAD_WINDOW } from "./optimize";
import type { Appel, DayStop, TechRoute } from "./types";

export type ScheduleGap = {
  startMin: number;
  endMin: number;
  /** Minutes available after reserving travel in/out buffers. */
  freeMin: number;
  afterStopId: string | null;
  label: string;
  /** True when this is leftover time after the last job. */
  endOfDay: boolean;
};

export type PreventifSuggestion = {
  techId: string;
  appel: Appel;
  gap: ScheduleGap;
  insertAfterIndex: number;
  /** Estimated start if accepted. */
  suggestedStartMin: number;
  minutesOnSite: number;
  reason: string;
};

const DEFAULT_TRAVEL = 15;
/** Min free minutes (after travel) to open a gap for a 60‑min PM. */
const MIN_GAP_FREE = 50;
const MIN_GAP_SPAN = 55;

function travelMinutes(route: TechRoute, stopIndex: number): number {
  const leg = route.google?.legs?.[stopIndex];
  if (leg && leg.durationSeconds > 0) {
    return Math.max(5, Math.round(leg.durationSeconds / 60));
  }
  return DEFAULT_TRAVEL;
}

/** Job windows on the timeline (same rules as the calendar). */
export function jobWindows(route: TechRoute): Array<{
  stop: DayStop;
  index: number;
  startMin: number;
  endMin: number;
}> {
  const windows: Array<{
    stop: DayStop;
    index: number;
    startMin: number;
    endMin: number;
  }> = [];
  let cursor = parseMinutes(route.tech.startHour || ROAD_WINDOW.start);

  route.stops.forEach((stop, index) => {
    cursor += travelMinutes(route, index);
    let startMin = cursor;
    if (stop.pinned && stop.appel.heure) {
      startMin = Math.max(startMin, parseMinutes(stop.appel.heure));
    }
    const endMin = startMin + stop.minutesOnSite;
    windows.push({ stop, index, startMin, endMin });
    cursor = endMin;
  });

  return windows;
}

export function findGaps(route: TechRoute): ScheduleGap[] {
  const windows = jobWindows(route);
  const dayStart = parseMinutes(route.tech.startHour || ROAD_WINDOW.start);
  const dayEnd = Math.min(
    parseMinutes(route.tech.endHour || ROAD_WINDOW.softEnd),
    parseMinutes(ROAD_WINDOW.softEnd),
  );
  const gaps: ScheduleGap[] = [];

  let cursor = dayStart;
  let previousId: string | null = null;
  for (const win of windows) {
    if (win.startMin - cursor >= MIN_GAP_SPAN) {
      const freeMin = win.startMin - cursor - DEFAULT_TRAVEL;
      if (freeMin >= MIN_GAP_FREE) {
        gaps.push({
          startMin: cursor,
          endMin: win.startMin,
          freeMin,
          afterStopId: previousId,
          label: `Créneau libre ${formatClock(cursor)}–${formatClock(win.startMin)}`,
          endOfDay: false,
        });
      }
    }
    cursor = win.endMin;
    previousId = win.stop.appel.id;
  }

  if (dayEnd - cursor >= MIN_GAP_SPAN) {
    const freeMin = dayEnd - cursor - DEFAULT_TRAVEL;
    if (freeMin >= MIN_GAP_FREE) {
      gaps.push({
        startMin: cursor,
        endMin: dayEnd,
        freeMin,
        afterStopId: previousId,
        label: `Fin de journée libre dès ${formatClock(cursor)}`,
        endOfDay: true,
      });
    }
  }

  return gaps;
}

export function formatClock(total: number): string {
  const hours = Math.floor(Math.max(0, total) / 60);
  const minutes = Math.max(0, total) % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeClientKey(appel: Pick<Appel, "adresse" | "magasin">): string {
  return `${appel.adresse.trim().toLowerCase()}|${appel.magasin.trim().toLowerCase()}`;
}

function placeKey(value: string): string {
  return value.trim().toLocaleLowerCase("fr-CA");
}

function scoreCandidate(
  route: TechRoute,
  appel: Appel,
): { score: number; reason: string; afterStopIndex: number | null } {
  const canDo = route.tech.skills.includes(appel.equipementId);
  if (!canDo) return { score: -1, reason: "", afterStopIndex: null };

  const clientKey = normalizeClientKey(appel);
  const sameClientIndex = route.stops.findIndex(
    (stop) => normalizeClientKey(stop.appel) === clientKey,
  );
  if (sameClientIndex >= 0) {
    return {
      score: 10,
      reason: `Même client déjà sur la tournée (${appel.magasin}) — faire le préventif`,
      afterStopIndex: sameClientIndex,
    };
  }

  const sameAddressIndex = route.stops.findIndex(
    (stop) =>
      stop.appel.adresse.trim().toLowerCase() ===
      appel.adresse.trim().toLowerCase(),
  );
  if (sameAddressIndex >= 0) {
    return {
      score: 9,
      reason: `Même adresse qu'un arrêt — deux-pour-un`,
      afterStopIndex: sameAddressIndex,
    };
  }

  const villes = new Set(
    route.stops.map((stop) => placeKey(stop.appel.ville)).filter(Boolean),
  );
  const regions = new Set(
    route.stops.map((stop) => placeKey(stop.appel.region)).filter(Boolean),
  );

  if (appel.ville && villes.has(placeKey(appel.ville))) {
    return {
      score: 5,
      reason: `Même ville qu'un arrêt (${appel.ville})`,
      afterStopIndex: null,
    };
  }
  if (
    (appel.region && regions.has(placeKey(appel.region))) ||
    (appel.region && placeKey(appel.region) === placeKey(route.tech.region))
  ) {
    return {
      score: 3,
      reason: `Même région (${appel.region})`,
      afterStopIndex: null,
    };
  }
  return { score: 0, reason: "", afterStopIndex: null };
}

/**
 * Suggest unassigned préventifs that fit in each tech's free gaps.
 * Packs multiple PMs into large gaps (especially end of day) for denser days.
 */
export function suggestPreventifs(options: {
  routes: TechRoute[];
  candidates: Appel[];
  durations?: { preventif: number; reactif: number };
  maxPerTech?: number;
}): PreventifSuggestion[] {
  const durations = options.durations ?? DEFAULT_DURATIONS;
  const maxPerTech = options.maxPerTech ?? 6;
  const used = new Set<string>();
  const out: PreventifSuggestion[] = [];
  const minutesOnSite = onSiteMinutes("preventif", durations);
  const slotCost = minutesOnSite + DEFAULT_TRAVEL;

  for (const route of options.routes) {
    if (route.stops.length === 0) continue;
    const gaps = findGaps(route);
    if (gaps.length === 0) continue;

    // Pack end-of-day first, then largest mid-day gaps.
    const orderedGaps = [...gaps].sort((a, b) => {
      if (a.endOfDay !== b.endOfDay) return a.endOfDay ? -1 : 1;
      return b.freeMin - a.freeMin;
    });

    let added = 0;
    const ranked = options.candidates
      .filter((appel) => appel.type === "preventif" && !appel.planifie)
      .map((appel) => ({ appel, ...scoreCandidate(route, appel) }))
      .filter((item) => item.score > 0 && !used.has(item.appel.id))
      .sort((a, b) =>
        compareScoreThenDistance(
          {
            score: a.score,
            distanceKm: nearestStopKm(
              a.appel,
              route.stops.map((stop) => stop.appel),
            ),
          },
          {
            score: b.score,
            distanceKm: nearestStopKm(
              b.appel,
              route.stops.map((stop) => stop.appel),
            ),
          },
        ),
      );

    for (const gap of orderedGaps) {
      if (added >= maxPerTech) break;
      let remaining = gap.freeMin;
      let cursor = gap.startMin + DEFAULT_TRAVEL;
      let insertAfterIndex = gap.afterStopId
        ? route.stops.findIndex((s) => s.appel.id === gap.afterStopId)
        : -1;

      while (remaining >= minutesOnSite && added < maxPerTech) {
        const match =
          ranked.find((item) => {
            if (used.has(item.appel.id)) return false;
            // Prefer stacking same-client into end-of-day when available
            if (item.score >= 9 && !gap.endOfDay) {
              const hasEndGap = orderedGaps.some(
                (g) => g.endOfDay && g.freeMin >= minutesOnSite,
              );
              if (hasEndGap) return false;
            }
            return true;
          }) ?? null;
        if (!match) break;

        used.add(match.appel.id);

        let insertAt = insertAfterIndex;
        if (
          match.afterStopIndex != null &&
          gap.endOfDay &&
          match.afterStopIndex === route.stops.length - 1 &&
          added === 0
        ) {
          insertAt = match.afterStopIndex;
        }

        out.push({
          techId: route.tech.id,
          appel: match.appel,
          gap,
          insertAfterIndex: insertAt,
          suggestedStartMin: cursor,
          minutesOnSite,
          reason: match.reason,
        });
        added += 1;
        cursor += slotCost;
        remaining -= slotCost;
        // Subsequent packs in the same gap insert after the growing tail conceptually
        insertAfterIndex = Math.max(insertAfterIndex, route.stops.length - 1);
      }
    }
  }

  return out;
}
