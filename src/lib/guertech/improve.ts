// Recherche à grand voisinage (« détruire et reconstruire ») sur les tournées.
//
// Objectif, dans cet ordre :
//   1. placer le plus d'appels possible (un réactif vaut plus qu'un préventif) ;
//   2. pénalité forte pour chaque journée-technicien sous le plancher (5 appels) ;
//   3. puis le moins de route possible (minutes de conduite et pénalités de secteur).
// Les contraintes dures (journée de travail, rendez-vous fixes, compétences,
// délais SLA, quota de préventifs) restent dans evaluate() et canPlace().

export type Evaluated = { driveMin: number; driveKm: number; finish: number; depart: number };

export type LnsRoute = {
  tech: number;
  day: number;
  stops: number[];
  drive: number;
  driveKm: number;
  finish: number;
  depart: number;
};

export type LnsContext = {
  routes: LnsRoute[];
  callCount: number;
  evaluate: (stops: number[], tech: number) => Evaluated | null;
  /** Compétence, zone, technicien imposé, délai SLA, technicien réservé aux rendez-vous. */
  canPlace: (call: number, route: LnsRoute) => boolean;
  /** Appels qui ne bougent pas (rendez-vous, à replanifier). */
  fixed: Uint8Array;
  isPreventif: Uint8Array;
  /** Valeur d'un appel placé ce jour-là. */
  value: (call: number, day: number) => number;
  /** Coût d'une tournée en minutes (route, secteur, sauts). */
  routeCost: (route: LnsRoute, stops: number[], driveMin: number) => number;
  floor: number;
  floorPenalty: number;
  /** Journée imposée par des rendez-vous (hors plancher). */
  floorExempt: (route: LnsRoute) => boolean;
  /** Appels candidats : non placés, ni éloignés, ni hors horizon. */
  pool: number[];
  placed: Uint8Array;
  quota: number;
  pmCount: Int16Array;
  /** Minutes de route entre deux appels. */
  minutes: (from: number, to: number) => number;
  /** Minutes de route du départ de la tournée jusqu'à un appel. */
  fromStart: (route: LnsRoute, call: number) => number;
  seed?: number;
  maxIterations?: number;
  deadline: number;
};

/** Appels non placés examinés à chaque reconstruction. */
const CANDIDATES = 40;

export type LnsStats = { iterations: number; accepted: number; gain: number };

function rng(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export function improveRoutes(ctx: LnsContext): LnsStats {
  const random = rng(ctx.seed ?? 20261123);
  const routes = ctx.routes;
  const maxIterations = ctx.maxIterations ?? 4000;

  const routeObjective = (route: LnsRoute, stops = route.stops, driveMin = route.drive) => {
    let value = 0;
    for (const id of stops) value += ctx.value(id, route.day);
    const missing = ctx.floorExempt(route) ? 0 : Math.max(0, ctx.floor - stops.length);
    return value - ctx.routeCost(route, stops, driveMin) - missing * ctx.floorPenalty;
  };

  const objective = () => routes.reduce((sum, route) => sum + routeObjective(route), 0);

  const byDay = new Map<number, LnsRoute[]>();
  const byTech = new Map<number, LnsRoute[]>();
  for (const route of routes) {
    if (!byDay.has(route.day)) byDay.set(route.day, []);
    byDay.get(route.day)!.push(route);
    if (!byTech.has(route.tech)) byTech.set(route.tech, []);
    byTech.get(route.tech)!.push(route);
  }

  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];

  type Snapshot = Array<{ stops: number[]; eval: Evaluated }>;
  const snapshot = (list: LnsRoute[]): Snapshot =>
    list.map((route) => ({
      stops: route.stops.slice(),
      eval: { driveMin: route.drive, driveKm: route.driveKm, finish: route.finish, depart: route.depart },
    }));
  const restore = (list: LnsRoute[], saved: Snapshot) => {
    list.forEach((route, index) => {
      route.stops = saved[index].stops.slice();
      route.drive = saved[index].eval.driveMin;
      route.driveKm = saved[index].eval.driveKm;
      route.finish = saved[index].eval.finish;
      route.depart = saved[index].eval.depart;
    });
  };
  const commit = (route: LnsRoute, stops: number[], evaluated: Evaluated) => {
    route.stops = stops;
    route.drive = evaluated.driveMin;
    route.driveKm = evaluated.driveKm;
    route.finish = evaluated.finish;
    route.depart = evaluated.depart;
  };

  const setPlaced = (id: number, route: LnsRoute, on: boolean) => {
    ctx.placed[id] = on ? 1 : 0;
    if (ctx.isPreventif[id]) ctx.pmCount[route.day] += on ? 1 : -1;
  };

  const removeFrom = (route: LnsRoute, ids: Set<number>): number[] => {
    const kept = route.stops.filter((id) => !ids.has(id));
    const removed = route.stops.filter((id) => ids.has(id));
    if (removed.length === 0) return removed;
    const evaluated = ctx.evaluate(kept, route.tech);
    if (!evaluated) return [];
    for (const id of removed) setPlaced(id, route, false);
    commit(route, kept, evaluated);
    return removed;
  };

  // Meilleure insertion d'un appel dans une tournée : gain et position.
  const bestInsert = (call: number, route: LnsRoute) => {
    if (!ctx.canPlace(call, route)) return null;
    if (ctx.isPreventif[call] && ctx.pmCount[route.day] >= ctx.quota) return null;
    const base = routeObjective(route);
    let best: { gain: number; stops: number[]; evaluated: Evaluated } | null = null;
    for (let pos = 0; pos <= route.stops.length; pos += 1) {
      const next = route.stops.slice();
      next.splice(pos, 0, call);
      const evaluated = ctx.evaluate(next, route.tech);
      if (!evaluated) continue;
      const gain = routeObjective(route, next, evaluated.driveMin) - base;
      if (!best || gain > best.gain) best = { gain, stops: next, evaluated };
    }
    return best;
  };

  // Reconstruction : insertion gloutonne avec regret sur les tournées touchées.
  const recreate = (affected: LnsRoute[], candidates: number[], noise: number) => {
    const open = new Set(candidates.filter((id) => !ctx.placed[id]));
    const cache = new Map<number, Array<ReturnType<typeof bestInsert>>>();
    const refresh = (id: number, index: number) => {
      if (!cache.has(id)) cache.set(id, new Array(affected.length).fill(null));
      cache.get(id)![index] = bestInsert(id, affected[index]);
    };
    for (const id of open) for (let index = 0; index < affected.length; index += 1) refresh(id, index);
    for (;;) {
      let chosen = -1;
      let chosenRoute = -1;
      let chosenScore = -Infinity;
      for (const id of open) {
        const options = cache.get(id)!;
        let first = -Infinity;
        let second = -Infinity;
        let at = -1;
        options.forEach((option, index) => {
          if (!option) return;
          if (option.gain > first) {
            second = first;
            first = option.gain;
            at = index;
          } else if (option.gain > second) second = option.gain;
        });
        if (at < 0 || first <= 0) continue;
        const regret = Number.isFinite(second) ? first - second : first;
        const score = first + 0.3 * Math.min(regret, 300) + noise * random() * 60;
        if (score > chosenScore) {
          chosenScore = score;
          chosen = id;
          chosenRoute = at;
        }
      }
      if (chosen < 0) break;
      const option = cache.get(chosen)![chosenRoute]!;
      const route = affected[chosenRoute];
      commit(route, option.stops, option.evaluated);
      setPlaced(chosen, route, true);
      open.delete(chosen);
      for (const id of open) refresh(id, chosenRoute);
      // Le quota de préventifs du jour peut avoir changé pour les autres tournées du même jour.
      if (ctx.isPreventif[chosen] && ctx.pmCount[route.day] >= ctx.quota) {
        for (const id of open) {
          if (!ctx.isPreventif[id]) continue;
          affected.forEach((other, index) => {
            if (other.day === route.day) cache.get(id)![index] = null;
          });
        }
      }
    }
  };

  const removable = (route: LnsRoute) => route.stops.filter((id) => !ctx.fixed[id]);

  // Appels non placés proches des tournées touchées (limite le calcul).
  // Appels non placés les plus proches des tournées touchées (limite le calcul) :
  // près d'un arrêt, ou pas plus loin du départ que ce que la tournée visitait.
  const nearbyPool = (affected: LnsRoute[], removed: number[]) => {
    const anchors = new Set<number>(removed);
    for (const route of affected) for (const id of route.stops) anchors.add(id);
    const reach = affected.map((route) => {
      let far = 0;
      for (const id of anchors) far = Math.max(far, ctx.fromStart(route, id));
      return far + 15;
    });
    const scored: Array<{ id: number; d: number }> = [];
    for (const id of ctx.pool) {
      if (ctx.placed[id] || anchors.has(id)) continue;
      let d = Infinity;
      for (const anchor of anchors) d = Math.min(d, ctx.minutes(anchor, id));
      for (let index = 0; index < affected.length; index += 1) {
        const fromStart = ctx.fromStart(affected[index], id);
        if (fromStart <= reach[index]) d = Math.min(d, Math.max(0, fromStart - reach[index] + 45));
      }
      if (anchors.size === 0) d = Math.min(d, ...affected.map((route) => ctx.fromStart(route, id)));
      if (d <= 45) scored.push({ id, d });
    }
    scored.sort((a, b) => a.d - b.d || a.id - b.id);
    return removed.concat(scored.slice(0, CANDIDATES).map((item) => item.id));
  };

  const ruinRoutes = (affected: LnsRoute[]) => {
    const removed: number[] = [];
    for (const route of affected) {
      removed.push(...removeFrom(route, new Set(removable(route))));
    }
    return removed;
  };

  let current = objective();
  let best = current;
  let bestState = snapshot(routes);
  let bestPlaced = ctx.placed.slice();
  let bestPm = ctx.pmCount.slice();
  let accepted = 0;
  let iterations = 0;
  const start = current;
  let temperature = 40;

  while (iterations < maxIterations && Date.now() < ctx.deadline) {
    iterations += 1;
    temperature = Math.max(1, temperature * 0.999);
    const move = random();
    let affected: LnsRoute[] = [];
    const seedRoute = routes.some((route) => !ctx.floorExempt(route) && route.stops.length < ctx.floor) && random() < 0.5
      ? pick(routes.filter((route) => !ctx.floorExempt(route) && route.stops.length < ctx.floor))
      : pick(routes);
    if (move < 0.3) {
      affected = [seedRoute];
    } else if (move < 0.55) {
      const sameDay = byDay.get(seedRoute.day)!.filter((route) => route !== seedRoute);
      affected = sameDay.length ? [seedRoute, pick(sameDay)] : [seedRoute];
    } else if (move < 0.7) {
      const sameTech = byTech.get(seedRoute.tech)!.filter((route) => route !== seedRoute);
      affected = sameTech.length ? [seedRoute, pick(sameTech)] : [seedRoute];
    } else {
      // Grappe géographique : un appel placé et ses voisins placés le même jour.
      const dayRoutes = byDay.get(seedRoute.day)!;
      const stops = dayRoutes.flatMap((route) => removable(route).map((id) => ({ id, route })));
      if (stops.length === 0) continue;
      const center = pick(stops).id;
      const size = 3 + Math.floor(random() * 6);
      const nearest = stops
        .map((item) => ({ ...item, d: ctx.minutes(center, item.id) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, size);
      affected = [...new Set(nearest.map((item) => item.route))];
      const before = snapshot(affected);
      const placedBefore = ctx.placed.slice();
      const pmBefore = ctx.pmCount.slice();
      const old = affected.reduce((sum, route) => sum + routeObjective(route), 0);
      const ids = new Set(nearest.map((item) => item.id));
      const removed: number[] = [];
      for (const route of affected) removed.push(...removeFrom(route, ids));
      recreate(affected, nearbyPool(affected, removed), 1);
      const now = affected.reduce((sum, route) => sum + routeObjective(route), 0);
      const delta = now - old;
      if (delta > 0.5 || random() < Math.exp(delta / temperature)) {
        current += delta;
        if (delta > 0.5) accepted += 1;
      } else {
        restore(affected, before);
        ctx.placed.set(placedBefore);
        ctx.pmCount.set(pmBefore);
      }
      if (current > best + 0.5) {
        best = current;
        bestState = snapshot(routes);
        bestPlaced = ctx.placed.slice();
        bestPm = ctx.pmCount.slice();
      }
      continue;
    }
    const before = snapshot(affected);
    const placedBefore = ctx.placed.slice();
    const pmBefore = ctx.pmCount.slice();
    const old = affected.reduce((sum, route) => sum + routeObjective(route), 0);
    const removed = ruinRoutes(affected);
    const pool = nearbyPool(affected, removed);
    // Graine : un appel du bassin, placé d'abord dans la première tournée.
    if (random() < 0.5 && affected[0].stops.length === 0) {
      const seeds = pool.filter((id) => !ctx.placed[id] && bestInsert(id, affected[0]));
      if (seeds.length) {
        const seed = pick(seeds);
        const option = bestInsert(seed, affected[0]);
        if (option) {
          commit(affected[0], option.stops, option.evaluated);
          setPlaced(seed, affected[0], true);
        }
      }
    }
    recreate(affected, pool, 1);
    const now = affected.reduce((sum, route) => sum + routeObjective(route), 0);
    const delta = now - old;
    if (delta > 0.5 || random() < Math.exp(delta / temperature)) {
      current += delta;
      if (delta > 0.5) accepted += 1;
    } else {
      restore(affected, before);
      ctx.placed.set(placedBefore);
      ctx.pmCount.set(pmBefore);
    }
    if (current > best + 0.5) {
      best = current;
      bestState = snapshot(routes);
      bestPlaced = ctx.placed.slice();
      bestPm = ctx.pmCount.slice();
    }
  }

  restore(routes, bestState);
  ctx.placed.set(bestPlaced);
  ctx.pmCount.set(bestPm);
  return { iterations, accepted, gain: Math.round(best - start) };
}
