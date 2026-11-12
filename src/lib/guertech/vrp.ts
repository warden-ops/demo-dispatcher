import { onSiteMinutes, parseMinutes } from "./assign";
import {
  addBusinessDays,
  formatDayLabel,
  formatHoursFr,
  formatKmFr,
  workingDaysFrom,
} from "./calendar";
import { SLA } from "./constants";
import { ROAD_WINDOW } from "./optimize";
import type { TravelMatrix } from "./travel";
import type { Appel, RemoteTrip, Tech, Unassigned } from "./types";

const REMOTE_CLUSTER_MIN = 240;
const OVERNIGHT_ONE_WAY_MIN = 300;
const EARLIEST_DEPART_MIN = 5 * 60;
const ZONE_PENALTY_MIN = 45;
const LOAD_WEIGHT = 0.25;

export type PlannedStop = {
  appel: Appel;
  minutesOnSite: number;
  pinned: boolean;
  reason: string;
  driveMin: number;
  driveKm: number;
  arriveMin: number;
  leaveMin: number;
};

export type PlannedRoute = {
  techId: string;
  date: string;
  stops: PlannedStop[];
  totalDriveMin: number;
  totalDriveKm: number;
  returnDriveMin: number;
  returnDriveKm: number;
  finishMin: number;
  /** Départ du dépôt. Avant 8 h seulement pour arriver à un rendez-vous fixe. */
  departMin: number;
};

export type SolveResult = {
  days: Array<{ date: string; routes: PlannedRoute[] }>;
  unassigned: Unassigned[];
  remoteTrips: RemoteTrip[];
  stats: {
    driveMin: number;
    driveKm: number;
    served: number;
    reactivesServed: number;
    reactives: number;
    slaMisses: number;
    remoteCalls: number;
    elapsedMs: number;
    overtimeRoutes: number;
  };
};

export type SolveInput = {
  calls: Appel[];
  techs: Tech[];
  matrix: TravelMatrix;
  startDate: string;
  horizonDays?: number;
  pmQuotaPerDay?: number;
  durations?: { preventif: number; reactif: number };
  allowOvertime?: boolean;
  moveAssigned?: boolean;
  budgetMs?: number;
};

type MutableRoute = {
  tech: number;
  day: number;
  stops: number[];
  drive: number;
  driveKm: number;
  finish: number;
  depart: number;
};

function at(values: Float64Array, size: number, from: number, to: number): number {
  return values[from * size + to];
}

export function solveVrp(input: SolveInput): SolveResult {
  const started = Date.now();
  const calls = input.calls;
  const techs = input.techs;
  const callCount = calls.length;
  const techCount = techs.length;
  const days = workingDaysFrom(input.startDate, input.horizonDays ?? 5);
  const quota = input.pmQuotaPerDay ?? 40;
  const durations = input.durations;
  const matrix = input.matrix;
  const size = matrix.size;
  const emptyStats = {
    driveMin: 0,
    driveKm: 0,
    served: 0,
    reactivesServed: 0,
    reactives: 0,
    slaMisses: 0,
    remoteCalls: 0,
    elapsedMs: 0,
    overtimeRoutes: 0,
  };

  if (techCount === 0) {
    return {
      days: [],
      unassigned: calls.map((appel) => ({
        appel,
        reason: "Aucun technicien présent.",
      })),
      remoteTrips: [],
      stats: { ...emptyStats, elapsedMs: Date.now() - started },
    };
  }

  if (days.length === 0 || size < callCount + techCount) {
    return {
      days: [],
      unassigned: calls.map((appel) => ({
        appel,
        reason: "Planification impossible (horizon ou matrice de trajet).",
      })),
      remoteTrips: [],
      stats: { ...emptyStats, elapsedMs: Date.now() - started },
    };
  }

  const dayStart = new Int16Array(techCount);
  const dayEnd = new Int16Array(techCount);
  for (let tech = 0; tech < techCount; tech += 1) {
    const item = techs[tech];
    let start = parseMinutes(item.startHour || ROAD_WINDOW.start);
    start = Math.max(8 * 60, start);
    let end = parseMinutes(item.endHour || ROAD_WINDOW.softEnd);
    if (input.allowOvertime) end = Math.max(end, 17 * 60) + 120;
    else end = Math.min(end, 17 * 60);
    if (end < start + 60) end = start + 60;
    dayStart[tech] = start;
    dayEnd[tech] = end;
  }

  const service = new Int16Array(callCount);
  const heureMin = new Int16Array(callCount);
  const isPinned = new Uint8Array(callCount);
  const locked = new Int16Array(callCount).fill(-1);
  const overdue = new Uint8Array(callCount);
  const deadlineDay = new Int16Array(callCount).fill(days.length - 1);
  const techById = new Map(techs.map((tech, index) => [tech.id, index]));
  const regionIds = new Map<string, number>();
  const regionIdOf = (value: string) => {
    const key = value.trim();
    if (!key) return 0;
    const existing = regionIds.get(key);
    if (existing != null) return existing;
    const id = regionIds.size + 1;
    regionIds.set(key, id);
    return id;
  };
  const techRegion = techs.map((tech) => regionIdOf(tech.region));
  const callRegion = calls.map((appel) => regionIdOf(appel.region));
  const covered = new Uint8Array(regionIds.size + 1);
  for (const region of techRegion) {
    if (region !== 0) covered[region] = 1;
  }

  const pinKind = new Array<"hard" | "replan" | "later" | "none">(callCount).fill(
    "none",
  );
  const pinDay = new Int16Array(callCount).fill(-1);
  for (let index = 0; index < callCount; index += 1) {
    const appel = calls[index];
    service[index] = onSiteMinutes(appel.type, durations);
    const when = (appel.scheduledOn ?? "").slice(0, 10);
    if (appel.planifie && !when) {
      pinKind[index] = "hard";
      pinDay[index] = 0;
    } else if (appel.planifie && when < days[0]) {
      pinKind[index] = "replan";
    } else if (appel.planifie) {
      const day = days.indexOf(when);
      if (day >= 0) {
        pinKind[index] = "hard";
        pinDay[index] = day;
      } else {
        pinKind[index] = "later";
      }
    }
    if (pinKind[index] === "hard" && appel.heure) {
      isPinned[index] = 1;
      heureMin[index] = parseMinutes(appel.heure);
    }
    const due = addBusinessDays(appel.openedAt || input.startDate, SLA.reactif.delayDays);
    if (appel.type === "reactif") {
      if (due < days[0]) overdue[index] = 1;
      else {
        let maxDay = -1;
        for (let day = 0; day < days.length; day += 1) {
          if (days[day] <= due) maxDay = day;
        }
        deadlineDay[index] = maxDay;
      }
    }
    const owner = techById.get(appel.techId);
    if (pinKind[index] === "hard" && owner != null) locked[index] = owner;
    else if (!input.moveAssigned && appel.techId && owner != null && pinKind[index] !== "replan") {
      locked[index] = owner;
    }
  }

  const skillOk = new Uint8Array(techCount * callCount);
  for (let tech = 0; tech < techCount; tech += 1) {
    const skills = techs[tech].skills;
    const open = !skills || skills.length === 0;
    for (let call = 0; call < callCount; call += 1) {
      skillOk[tech * callCount + call] = open || skills.includes(calls[call].equipementId) ? 1 : 0;
    }
  }

  const zoneAllows = (tech: number, call: number): boolean => {
    if (techRegion[tech] === 0) return true;
    if (callRegion[call] === 0) return true;
    return techRegion[tech] === callRegion[call];
  };
  const canTake = (tech: number, call: number): boolean =>
    skillOk[tech * callCount + call] === 1 && zoneAllows(tech, call);

  const remote = new Uint8Array(callCount);
  for (let call = 0; call < callCount; call += 1) {
    if (pinKind[call] === "hard" || pinKind[call] === "later") continue;
    let fits = false;
    for (let tech = 0; tech < techCount; tech += 1) {
      const depot = callCount + tech;
      const outbound = at(matrix.minutes, size, depot, call);
      const inbound = at(matrix.minutes, size, call, depot);
      if (dayStart[tech] + outbound + service[call] + inbound <= dayEnd[tech]) {
        fits = true;
        break;
      }
    }
    if (!fits) remote[call] = 1;
  }

  const timedPin = (id: number) => isPinned[id] === 1 && heureMin[id] > 0;

  const simulate = (
    stops: number[],
    tech: number,
    depart: number,
  ): {
    driveMin: number;
    driveKm: number;
    finish: number;
    depart: number;
    missedBy: number;
  } | null => {
    const depot = callCount + tech;
    const end = dayEnd[tech];
    if (stops.length === 0) {
      return { driveMin: 0, driveKm: 0, finish: depart, depart, missedBy: 0 };
    }
    let time = depart;
    let prev = depot;
    let driveMin = 0;
    let driveKm = 0;
    let missedBy = 0;
    for (const id of stops) {
      const travel = at(matrix.minutes, size, prev, id);
      const dist = at(matrix.km, size, prev, id);
      let arrival = time + travel;
      driveMin += travel;
      driveKm += dist;
      if (timedPin(id)) {
        const heure = heureMin[id];
        if (arrival > heure) missedBy = Math.max(missedBy, arrival - heure);
        else if (heure > arrival) arrival = heure;
      }
      const leave = arrival + service[id];
      if (!timedPin(id) && leave > end) return null;
      time = leave;
      prev = id;
    }
    const back = at(matrix.minutes, size, prev, depot);
    const finish = time + back;
    const last = stops[stops.length - 1];
    if (finish > end && !timedPin(last)) return null;
    return {
      driveMin: driveMin + back,
      driveKm: driveKm + at(matrix.km, size, prev, depot),
      finish,
      depart,
      missedBy,
    };
  };

  const evaluate = (
    stops: number[],
    tech: number,
  ): { driveMin: number; driveKm: number; finish: number; depart: number } | null => {
    const start = dayStart[tech];
    let simulated = simulate(stops, tech, start);
    if (simulated && simulated.missedBy > 0) {
      const earlier = Math.max(EARLIEST_DEPART_MIN, start - simulated.missedBy);
      simulated = simulate(stops, tech, earlier);
    }
    if (!simulated || simulated.missedBy > 0) return null;
    return simulated;
  };

  const routes: MutableRoute[] = [];
  for (let day = 0; day < days.length; day += 1) {
    for (let tech = 0; tech < techCount; tech += 1) {
      routes.push({
        tech,
        day,
        stops: [],
        drive: 0,
        driveKm: 0,
        finish: dayStart[tech],
        depart: dayStart[tech],
      });
    }
  }
  const routeAt = (day: number, tech: number) => routes[day * techCount + tech];
  const pmCount = new Int16Array(days.length);
  const unassigned: Unassigned[] = [];
  const placed = new Uint8Array(callCount);

  const commit = (
    route: MutableRoute,
    stops: number[],
    evaluated: { driveMin: number; driveKm: number; finish: number; depart: number },
  ) => {
    route.stops = stops;
    route.drive = evaluated.driveMin;
    route.driveKm = evaluated.driveKm;
    route.finish = evaluated.finish;
    route.depart = evaluated.depart;
  };

  const pins = calls
    .map((appel, index) => ({ appel, index }))
    .filter((item) => item.appel.planifie && !remote[item.index])
    .sort((a, b) => {
      const heure = parseMinutes(a.appel.heure || "99:00") - parseMinutes(b.appel.heure || "99:00");
      if (heure !== 0) return heure;
      return a.appel.id < b.appel.id ? -1 : 1;
    });

  const placeTimedPin = (index: number, tech: number, day: number) => {
    const route = routeAt(day, tech);
    const next = route.stops.concat(index);
    const evaluated = evaluate(next, tech);
    if (!evaluated) return false;
    commit(route, next, evaluated);
    placed[index] = 1;
    return true;
  };

  for (let index = 0; index < callCount; index += 1) {
    if (pinKind[index] !== "later") continue;
    const when = calls[index].scheduledOn;
    unassigned.push({
      appel: calls[index],
      reason: `Rendez-vous le ${when}, hors de cet horizon.`,
    });
    placed[index] = 1;
  }

  for (const pin of pins) {
    if (pinKind[pin.index] !== "hard" || !pin.appel.heure) continue;
    const named = techById.get(pin.appel.techId);
    const day = pinDay[pin.index];
    if (pin.appel.techId && named == null) {
      unassigned.push({
        appel: pin.appel,
        reason: "Rendez-vous planifié : le technicien n'est pas présent.",
      });
      continue;
    }
    if (named != null && placeTimedPin(pin.index, named, day)) continue;
    if (named != null) {
      unassigned.push({
        appel: pin.appel,
        reason: `Rendez-vous planifié incompatible avec un départ dès 5 h et un retour après ${ROAD_WINDOW.softEndLabel}.`,
      });
      continue;
    }
    let placedTech = false;
    for (let tech = 0; tech < techCount; tech += 1) {
      if (placeTimedPin(pin.index, tech, day)) {
        placedTech = true;
        break;
      }
    }
    if (!placedTech) {
      unassigned.push({
        appel: pin.appel,
        reason: `Rendez-vous planifié incompatible avec un départ dès 5 h et un retour après ${ROAD_WINDOW.softEndLabel}.`,
      });
    }
  }

  const dayAllowed = (call: number, day: number): boolean => {
    if (calls[call].type !== "reactif") return true;
    if (overdue[call]) return true;
    return day <= deadlineDay[call];
  };

  const zonePenalty = (tech: number, call: number): number => {
    const region = callRegion[call];
    if (region === 0 || !covered[region]) return 0;
    return techRegion[tech] === region ? 0 : ZONE_PENALTY_MIN;
  };

  const jumpPenalty = (stops: number[]): number => {
    let penalty = 0;
    for (let index = 1; index < stops.length; index += 1) {
      const leg = at(matrix.minutes, size, stops[index - 1], stops[index]);
      if (leg > 45) penalty += 70;
    }
    return penalty;
  };

  const assignmentScore = (
    driveMin: number,
    finish: number,
    tech: number,
    stops: number[],
  ): number => {
    const load = stops.length === 0 ? 0 : finish - dayStart[tech];
    let zone = 0;
    for (const id of stops) zone += zonePenalty(tech, id);
    return driveMin + zone + load * LOAD_WEIGHT + jumpPenalty(stops);
  };

  type Choice = {
    day: number;
    tech: number;
    pos: number;
    extra: number;
    load: number;
    stops: number[];
    evaluated: { driveMin: number; driveKm: number; finish: number; depart: number };
  };

  const chooseInsertion = (call: number, asPreventif: boolean, dayBias = 4): Choice | null => {
    const choices: Choice[] = [];
    for (let day = 0; day < days.length; day += 1) {
      if (!dayAllowed(call, day)) continue;
      if (asPreventif && pmCount[day] >= quota) continue;
      for (let tech = 0; tech < techCount; tech += 1) {
        if (locked[call] >= 0 && locked[call] !== tech) continue;
        if (!canTake(tech, call)) continue;
        const route = routeAt(day, tech);
        const penalty = overdue[call] ? day * 400 : day * dayBias;
        const currentScore = assignmentScore(
          route.drive,
          route.finish,
          tech,
          route.stops,
        );
        for (let pos = 0; pos <= route.stops.length; pos += 1) {
          const next = route.stops.slice();
          next.splice(pos, 0, call);
          const evaluated = evaluate(next, tech);
          if (!evaluated) continue;
          choices.push({
            day,
            tech,
            pos,
            extra:
              assignmentScore(evaluated.driveMin, evaluated.finish, tech, next) -
              currentScore +
              penalty,
            load: route.stops.length === 0 ? 0 : route.finish - dayStart[tech],
            stops: next,
            evaluated,
          });
        }
      }
    }
    if (choices.length === 0) return null;
    let best = choices[0];
    for (const choice of choices.slice(1)) {
      const better =
        choice.extra < best.extra - 0.5 ||
        (Math.abs(choice.extra - best.extra) <= 0.5 &&
          (choice.load < best.load ||
            (choice.load === best.load &&
              (choice.day < best.day ||
                (choice.day === best.day &&
                  (choice.tech < best.tech ||
                    (choice.tech === best.tech && choice.pos < best.pos)))))));
      if (better) best = choice;
    }
    return best;
  };

  const explainSkip = (call: number, asPreventif: boolean): string => {
    let skilled = false;
    let zoned = false;
    for (let tech = 0; tech < techCount; tech += 1) {
      if (locked[call] >= 0 && locked[call] !== tech) continue;
      if (skillOk[tech * callCount + call] !== 1) continue;
      skilled = true;
      if (zoneAllows(tech, call)) zoned = true;
    }
    if (!skilled) return "Compétence équipement manquante.";
    if (!zoned) {
      return `Hors de la zone des techniciens (${calls[call].region}).`;
    }
    const counts = [...pmCount];
    if (asPreventif && counts.every((count) => count >= quota)) {
      return "Quota de préventifs atteint.";
    }
    if (calls[call].type === "reactif" && overdue[call]) {
      return "Délai SLA déjà dépassé et aucune journée n'a de place avant 17 h.";
    }
    if (calls[call].type === "reactif") {
      return "Aucun créneau avant la fin du délai SLA et avant 17 h.";
    }
    if (asPreventif && counts.some((count) => count >= quota)) {
      return "Journées restantes pleines avant 17 h. Le quota est déjà atteint sur les journées qui avaient encore du temps.";
    }
    return "Aucun créneau avant 17 h, retour au dépôt inclus.";
  };

  const replanOrder = calls
    .map((appel, index) => ({ appel, index }))
    .filter((item) => pinKind[item.index] === "replan" && !placed[item.index] && !remote[item.index])
    .sort((a, b) => (a.appel.scheduledOn ?? "").localeCompare(b.appel.scheduledOn ?? "") || (a.appel.id < b.appel.id ? -1 : 1));
  for (const item of replanOrder) {
    const owner = techById.get(item.appel.techId);
    if (owner != null) locked[item.index] = owner;
    let choice = chooseInsertion(item.index, false, 400);
    if (!choice && owner != null) {
      locked[item.index] = -1;
      choice = chooseInsertion(item.index, false, 400);
    }
    if (!choice) {
      unassigned.push({
        appel: item.appel,
        reason: "RDV à replanifier : aucun créneau avant 17 h.",
      });
      continue;
    }
    commit(routeAt(choice.day, choice.tech), choice.stops, choice.evaluated);
    placed[item.index] = 1;
  }

  for (let index = 0; index < callCount; index += 1) {
    const appel = calls[index];
    if (pinKind[index] !== "hard" || appel.heure || placed[index]) continue;
    const choice = chooseInsertion(index, false, 400);
    if (!choice) {
      unassigned.push({
        appel,
        reason: "Rendez-vous sans heure : aucun créneau dans la fenêtre 8 h–17 h.",
      });
      continue;
    }
    commit(routeAt(choice.day, choice.tech), choice.stops, choice.evaluated);
    placed[index] = 1;
  }

  const reactives = calls
    .map((appel, index) => ({ appel, index }))
    .filter(
      (item) =>
        item.appel.type === "reactif" &&
        !item.appel.planifie &&
        !remote[item.index] &&
        !placed[item.index],
    )
    .sort((a, b) => {
      if (overdue[a.index] !== overdue[b.index]) return overdue[b.index] - overdue[a.index];
      const dueA = addBusinessDays(a.appel.openedAt || input.startDate, SLA.reactif.delayDays);
      const dueB = addBusinessDays(b.appel.openedAt || input.startDate, SLA.reactif.delayDays);
      if (dueA !== dueB) return dueA < dueB ? -1 : 1;
      return a.appel.id < b.appel.id ? -1 : 1;
    });

  for (const item of reactives) {
    const choice = chooseInsertion(item.index, false);
    if (!choice) {
      unassigned.push({ appel: item.appel, reason: explainSkip(item.index, false) });
      continue;
    }
    commit(routeAt(choice.day, choice.tech), choice.stops, choice.evaluated);
    placed[item.index] = 1;
  }

  const preventifs: number[] = [];
  for (let index = 0; index < callCount; index += 1) {
    if (calls[index].type !== "preventif" || calls[index].planifie) continue;
    if (remote[index] || placed[index]) continue;
    preventifs.push(index);
  }
  const failed = new Set<number>();
  while (preventifs.some((index) => !failed.has(index) && !placed[index])) {
    let pick = -1;
    let bestDist = Infinity;
    let bestId = "";
    for (const index of preventifs) {
      if (failed.has(index) || placed[index]) continue;
      let dist = Infinity;
      for (const route of routes) {
        for (const stop of route.stops) {
          dist = Math.min(dist, at(matrix.km, size, index, stop));
        }
      }
      if (!Number.isFinite(dist) || dist === Infinity) {
        for (let tech = 0; tech < techCount; tech += 1) {
          if (!canTake(tech, index)) continue;
          dist = Math.min(dist, at(matrix.km, size, callCount + tech, index));
        }
      }
      const id = calls[index].id;
      if (
        dist < bestDist - 0.05 ||
        (Math.abs(dist - bestDist) <= 0.05 && (pick < 0 || id < bestId))
      ) {
        bestDist = dist;
        pick = index;
        bestId = id;
      }
    }
    if (pick < 0) break;
    const choice = chooseInsertion(pick, true);
    if (!choice) {
      failed.add(pick);
      unassigned.push({ appel: calls[pick], reason: explainSkip(pick, true) });
      continue;
    }
    commit(routeAt(choice.day, choice.tech), choice.stops, choice.evaluated);
    placed[pick] = 1;
    pmCount[choice.day] += 1;
  }

  const searchDeadline = started + Math.min(900, input.budgetMs ?? 900);
  const totalDrive = () => routes.reduce((sum, route) => sum + route.drive, 0);

  const twoOpt = (): boolean => {
    let improved = false;
    for (const route of routes) {
      if (route.stops.length < 3) continue;
      let guard = 0;
      while (guard < 4 && Date.now() < searchDeadline) {
        guard += 1;
        let bestStops: number[] | null = null;
        let best = route.drive;
        let bestEval: {
          driveMin: number;
          driveKm: number;
          finish: number;
          depart: number;
        } | null = null;
        for (let left = 0; left < route.stops.length - 1; left += 1) {
          for (let right = left + 1; right < route.stops.length; right += 1) {
            let blocked = false;
            for (let cursor = left; cursor <= right; cursor += 1) {
              if (isPinned[route.stops[cursor]]) blocked = true;
            }
            if (blocked) continue;
            const next = route.stops.slice();
            const segment = next.slice(left, right + 1).reverse();
            next.splice(left, segment.length, ...segment);
            const evaluated = evaluate(next, route.tech);
            if (evaluated && evaluated.driveMin <= best - 1) {
              best = evaluated.driveMin;
              bestStops = next;
              bestEval = evaluated;
            }
          }
        }
        if (!bestStops || !bestEval) break;
        commit(route, bestStops, bestEval);
        improved = true;
      }
    }
    return improved;
  };

  const relocate = (maxLength: number): boolean => {
    let bestDelta = 0;
    let apply: (() => void) | null = null;
    for (const source of routes) {
      if (Date.now() >= searchDeadline) break;
      for (let start = 0; start < source.stops.length; start += 1) {
        for (let length = 1; length <= maxLength && start + length <= source.stops.length; length += 1) {
          const chain = source.stops.slice(start, start + length);
          if (chain.some((id) => isPinned[id])) continue;
          if (length > 1) {
            const span = at(matrix.km, size, chain[0], chain[chain.length - 1]);
            if (span > 25) continue;
          }
          for (const target of routes) {
            if (target !== source && target.day !== source.day) continue;
            if (
              chain.some(
                (id) =>
                  (locked[id] >= 0 && locked[id] !== target.tech) ||
                  !canTake(target.tech, id) ||
                  !dayAllowed(id, target.day),
              )
            ) {
              continue;
            }
            if (source === target) {
              if (length === 1) continue;
              const without = source.stops.slice();
              without.splice(start, length);
              for (let pos = 0; pos <= without.length; pos += 1) {
                if (pos === start) continue;
                const next = without.slice();
                next.splice(pos, 0, ...chain);
                const evaluated = evaluate(next, source.tech);
                if (!evaluated) continue;
                const delta =
                  assignmentScore(evaluated.driveMin, evaluated.finish, source.tech, next) -
                  assignmentScore(source.drive, source.finish, source.tech, source.stops);
                if (delta <= bestDelta - 1) {
                  bestDelta = delta;
                  const snapshot = next;
                  const score = evaluated;
                  apply = () => commit(source, snapshot, score);
                }
              }
              continue;
            }
            const sourceNext = source.stops.slice();
            sourceNext.splice(start, length);
            const sourceEval = evaluate(sourceNext, source.tech);
            if (!sourceEval) continue;
            for (let pos = 0; pos <= target.stops.length; pos += 1) {
              const targetNext = target.stops.slice();
              targetNext.splice(pos, 0, ...chain);
              const targetEval = evaluate(targetNext, target.tech);
              if (!targetEval) continue;
              const delta =
                assignmentScore(sourceEval.driveMin, sourceEval.finish, source.tech, sourceNext) +
                assignmentScore(targetEval.driveMin, targetEval.finish, target.tech, targetNext) -
                assignmentScore(source.drive, source.finish, source.tech, source.stops) -
                assignmentScore(target.drive, target.finish, target.tech, target.stops);
              if (delta <= bestDelta - 1) {
                bestDelta = delta;
                apply = () => {
                  commit(source, sourceNext, sourceEval);
                  commit(target, targetNext, targetEval);
                };
              }
            }
          }
        }
      }
    }
    if (!apply) return false;
    apply();
    return true;
  };

  let searchPasses = 0;
  while (Date.now() < searchDeadline && searchPasses < 6) {
    searchPasses += 1;
    const before = totalDrive();
    twoOpt();
    relocate(1);
    if (Date.now() < searchDeadline) relocate(3);
    if (totalDrive() >= before - 0.5) break;
  }

  const describe = (route: MutableRoute) => {
    const depot = callCount + route.tech;
    const end = dayEnd[route.tech];
    let time = route.depart || dayStart[route.tech];
    let prev = depot;
    let driveMin = 0;
    let driveKm = 0;
    const stops: PlannedStop[] = [];
    for (let index = 0; index < route.stops.length; index += 1) {
      const id = route.stops[index];
      const travel = at(matrix.minutes, size, prev, id);
      const dist = at(matrix.km, size, prev, id);
      let arrival = time + travel;
      if (isPinned[id] && heureMin[id] > arrival) arrival = heureMin[id];
      const leave = arrival + service[id];
      const appel = calls[id];
      let reason: string;
      if (pinKind[id] === "replan") {
        reason = "RDV à replanifier";
      } else if (appel.planifie && appel.heure) {
        reason = `Rendez-vous planifié à ${appel.heure} (${days[pinDay[id]] ?? days[0]}).`;
      } else if (appel.planifie) {
        reason = "Rendez-vous sans heure : placé dans la fenêtre 8 h–17 h.";
      } else if (index > 0 && dist < 0.3) {
        reason = "Même adresse qu'un arrêt déjà sur la tournée.";
      } else if (appel.type === "reactif") {
        const due = addBusinessDays(appel.openedAt || days[0], SLA.reactif.delayDays);
        reason =
          due < days[0]
            ? "Réactif déjà hors délai (SLA de 2 jours ouvrables), placé le plus tôt possible."
            : `Réactif à faire avant le ${formatDayLabel(due)} (SLA de 2 jours ouvrables).`;
      } else {
        reason = `Préventif à proximité (${formatKmFr(dist)} de trajet).`;
      }
      stops.push({
        appel: { ...appel, techId: techs[route.tech].id },
        minutesOnSite: service[id],
        pinned: Boolean(isPinned[id]),
        reason,
        driveMin: Math.round(travel),
        driveKm: Math.round(dist * 10) / 10,
        arriveMin: Math.round(arrival),
        leaveMin: Math.round(leave),
      });
      driveMin += travel;
      driveKm += dist;
      time = leave;
      prev = id;
    }
    const returnDriveMin = Math.round(at(matrix.minutes, size, prev, depot));
    const returnDriveKm = Math.round(at(matrix.km, size, prev, depot) * 10) / 10;
    return {
      techId: techs[route.tech].id,
      date: days[route.day],
      stops,
      totalDriveMin: Math.round(driveMin + returnDriveMin),
      totalDriveKm: Math.round((driveKm + returnDriveKm) * 10) / 10,
      returnDriveMin,
      returnDriveKm,
      finishMin: Math.round(time + returnDriveMin),
      departMin: route.depart || dayStart[route.tech],
      withinWindow: time + at(matrix.minutes, size, prev, depot) <= end,
    };
  };

  const dayPlans = days.map((date, day) => ({
    date,
    routes: techs
      .map((_tech, tech) => describe(routeAt(day, tech)))
      .filter((route) => route.stops.length > 0),
  }));

  const servedDay = new Map<number, string>();
  let driveMin = 0;
  let driveKm = 0;
  let served = 0;
  let overtimeRoutes = 0;
  for (const day of dayPlans) {
    for (const route of day.routes) {
      driveMin += route.totalDriveMin;
      driveKm += route.totalDriveKm;
      served += route.stops.length;
      if (!route.withinWindow) overtimeRoutes += 1;
      for (const stop of route.stops) {
        const index = calls.findIndex((appel) => appel.id === stop.appel.id);
        if (index >= 0) servedDay.set(index, day.date);
      }
    }
  }

  let reactivesTotal = 0;
  let reactivesServed = 0;
  let slaMisses = 0;
  for (let index = 0; index < callCount; index += 1) {
    if (calls[index].type !== "reactif" || remote[index]) continue;
    reactivesTotal += 1;
    const due = addBusinessDays(calls[index].openedAt || days[0], SLA.reactif.delayDays);
    const when = servedDay.get(index) ?? "";
    if (when) reactivesServed += 1;
    if (due < days[0]) continue;
    if (!when || when > due) slaMisses += 1;
  }

  const remoteIndexes: number[] = [];
  for (let index = 0; index < callCount; index += 1) {
    if (remote[index]) remoteIndexes.push(index);
  }
  const remoteTrips = buildRemoteTrips({
    indexes: remoteIndexes,
    calls,
    matrix,
    callCount,
    techCount,
    service,
  });

  return {
    days: dayPlans.map((day) => ({
      date: day.date,
      routes: day.routes.map((route) => ({
      techId: route.techId,
      date: route.date,
      stops: route.stops,
      totalDriveMin: route.totalDriveMin,
      totalDriveKm: route.totalDriveKm,
      returnDriveMin: route.returnDriveMin,
      returnDriveKm: route.returnDriveKm,
      finishMin: route.finishMin,
      departMin: route.departMin,
    })),
    })),
    unassigned,
    remoteTrips,
    stats: {
      driveMin: Math.round(driveMin),
      driveKm: Math.round(driveKm),
      served,
      reactivesServed,
      reactives: reactivesTotal,
      slaMisses,
      remoteCalls: remoteIndexes.length,
      elapsedMs: Date.now() - started,
      overtimeRoutes,
    },
  };
}

function buildRemoteTrips(input: {
  indexes: number[];
  calls: Appel[];
  matrix: TravelMatrix;
  callCount: number;
  techCount: number;
  service: Int16Array;
}): RemoteTrip[] {
  const { indexes, calls, matrix, callCount, techCount, service } = input;
  if (indexes.length === 0 || techCount === 0) return [];
  const size = matrix.size;
  const link = (from: number, to: number) =>
    Math.min(at(matrix.minutes, size, from, to), at(matrix.minutes, size, to, from));
  let groups = indexes.map((id) => [id]);
  while (groups.length > 1) {
    let bestI = -1;
    let bestJ = -1;
    let best = Infinity;
    for (let left = 0; left < groups.length; left += 1) {
      for (let right = left + 1; right < groups.length; right += 1) {
        let max = 0;
        for (const origin of groups[left]) {
          for (const destination of groups[right]) {
            max = Math.max(max, link(origin, destination));
          }
        }
        if (max < best) {
          best = max;
          bestI = left;
          bestJ = right;
        }
      }
    }
    if (bestI < 0 || best > REMOTE_CLUSTER_MIN) break;
    const merged = groups[bestI].concat(groups[bestJ]);
    const next = groups.filter((_, index) => index !== bestI && index !== bestJ);
    next.push(merged);
    groups = next;
  }

  const nearestDepotMinutes = (call: number) => {
    let best = Infinity;
    let kmBest = Infinity;
    for (let tech = 0; tech < techCount; tech += 1) {
      const depot = callCount + tech;
      const minutes = at(matrix.minutes, size, depot, call);
      if (minutes < best) {
        best = minutes;
        kmBest = at(matrix.km, size, depot, call);
      }
    }
    return { minutes: best, km: kmBest };
  };

  return groups
    .map((members) => {
      let start = members[0];
      let startLeg = nearestDepotMinutes(start);
      for (const id of members) {
        const leg = nearestDepotMinutes(id);
        if (leg.minutes < startLeg.minutes) {
          start = id;
          startLeg = leg;
        }
      }
      const left = new Set(members);
      const ordered = [start];
      left.delete(start);
      while (left.size > 0) {
        const last = ordered[ordered.length - 1];
        let next = -1;
        let near = Infinity;
        for (const id of left) {
          const minutes = link(last, id);
          if (minutes < near || (minutes === near && (next < 0 || calls[id].id < calls[next].id))) {
            near = minutes;
            next = id;
          }
        }
        ordered.push(next);
        left.delete(next);
      }
      let localDriveMin = 0;
      let localDriveKm = 0;
      let onSite = 0;
      for (let index = 0; index < ordered.length; index += 1) {
        onSite += service[ordered[index]];
        if (index === 0) continue;
        localDriveMin += at(matrix.minutes, size, ordered[index - 1], ordered[index]);
        localDriveKm += at(matrix.km, size, ordered[index - 1], ordered[index]);
      }
      const villes: string[] = [];
      for (const id of ordered) {
        const ville = calls[id].ville || calls[id].region || "secteur éloigné";
        if (!villes.includes(ville)) villes.push(ville);
      }
      const area =
        villes.length <= 1
          ? (villes[0] ?? "secteur éloigné")
          : villes.length === 2
            ? `${villes[0]} et ${villes[1]}`
            : `${villes.slice(0, -1).join(", ")} et ${villes[villes.length - 1]}`;
      const onSiteDays = Math.max(1, Math.ceil((localDriveMin + onSite) / (8 * 60)));
      const kind =
        startLeg.minutes >= OVERNIGHT_ONE_WAY_MIN || onSiteDays > 1
          ? "nuitée"
          : "trajet dédié";
      const way = formatHoursFr(startLeg.minutes);
      let reason = `Aller-retour impossible entre 8 h et 17 h (environ ${way} aller depuis Drummondville). `;
      reason +=
        ordered.length === 1
          ? `Trajet dédié pour ${area}.`
          : `${ordered.length} appels à ${area} groupés en un seul voyage.`;
      if (kind === "nuitée") {
        reason += " Le retour au dépôt le même jour n'est pas possible : prévoir une nuitée.";
      }
      if (onSiteDays > 1) {
        reason += ` Le travail sur place prend environ ${onSiteDays} jours.`;
      }
      return {
        id: `voyage-${calls[ordered[0]].id}`,
        area,
        kind,
        reason,
        calls: ordered.map((id) => ({
          appel: calls[id],
          minutesOnSite: service[id],
          reason:
            ordered.length > 1
              ? `Même voyage que les autres appels de ${area}.`
              : "Trop loin pour revenir au dépôt le même jour.",
        })),
        localDriveMin: Math.round(localDriveMin),
        localDriveKm: Math.round(localDriveKm),
        depotOneWayMin: Math.round(startLeg.minutes),
        depotOneWayKm: Math.round(startLeg.km),
        onSiteDays,
      } satisfies RemoteTrip;
    })
    .sort((a, b) => b.depotOneWayMin - a.depotOneWayMin || (a.area < b.area ? -1 : 1));
}
