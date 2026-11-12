"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CallList } from "@/components/guertech/CallList";
import { HelpGuide } from "@/components/guertech/HelpGuide";
import { RouteBoard } from "@/components/guertech/RouteBoard";
import { TechRoster } from "@/components/guertech/TechRoster";
import {
  ALL_SKILL_IDS,
  countBusinessDays,
  DRUMMONDVILLE_HQ,
  isReactifOverdue,
  preventifPerBusinessDay,
  QUARTER,
  SLA,
} from "@/lib/guertech/constants";
import { loadAppels } from "@/lib/guertech/csv";
import { onSiteMinutes } from "@/lib/guertech/assign";
import {
  evaluateRoadWindow,
  mergePinnedOptimal,
  optimizeDay,
  ROAD_WINDOW,
  trimToSoftEnd,
  type OvertimeWarning,
} from "@/lib/guertech/optimize";
import {
  blankCallAssignments,
  createBlankRoster,
  DEMO_PLAN_DATE,
  parseDurations,
  suggestPlannerFields,
  todayIsoDate,
} from "@/lib/guertech/suggest-form";
import { formatDayLabel, formatHoursFr } from "@/lib/guertech/calendar";
import {
  suggestPreventifs,
  type PreventifSuggestion,
} from "@/lib/guertech/suggestions";
import type {
  Appel,
  CallType,
  DayStop,
  PlanStats,
  RemoteTrip,
  Tech,
  TechRoute,
  Unassigned,
} from "@/lib/guertech/types";
import type { OptimizeRouteResponse } from "@/lib/types";

type PlanRouteResponse = {
  techId: string;
  stops: DayStop[];
  totalDriveMin: number;
  totalDriveKm: number;
  returnDriveMin: number;
  returnDriveKm: number;
  finishMin: number;
};

type PlanDayResponse = {
  date: string;
  routes: PlanRouteResponse[];
};

type PlanResponse = {
  days: PlanDayResponse[];
  unassigned: Unassigned[];
  remoteTrips: RemoteTrip[];
  stats: PlanStats;
  error?: string;
};

function toTechRoutes(
  day: PlanDayResponse,
  techs: Tech[],
  source: PlanStats["travelSource"],
): TechRoute[] {
  const byId = new Map(day.routes.map((route) => [route.techId, route]));
  return techs
    .filter((tech) => tech.present)
    .map((tech) => {
      const plan = byId.get(tech.id);
      return {
        tech,
        stops: (plan?.stops ?? []).map((stop) => ({
          ...stop,
          appel: { ...stop.appel, techId: tech.id },
        })),
        google: null,
        error: null,
        planDate: day.date,
        totalDriveMin: plan?.totalDriveMin ?? 0,
        totalDriveKm: plan?.totalDriveKm ?? 0,
        returnDriveMin: plan?.returnDriveMin ?? 0,
        returnDriveKm: plan?.returnDriveKm ?? 0,
        finishMin: plan?.finishMin,
        travelSource: source,
      };
    });
}

async function fetchRoute(payload: {
  start: string;
  end: string;
  stops: { address: string; minutesOnSite: number }[];
  optimize: boolean;
  departureTime?: string;
}): Promise<OptimizeRouteResponse> {
  const response = await fetch("/api/optimize-route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as OptimizeRouteResponse & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || "Échec de l'optimisation Google.");
  }
  return data;
}

async function buildTechRoute(
  tech: Tech,
  stops: DayStop[],
): Promise<TechRoute> {
  if (stops.length === 0) {
    return { tech, stops: [], google: null, error: null };
  }

  const limited = [
    ...stops.filter((stop) => stop.pinned),
    ...stops.filter((stop) => !stop.pinned),
  ].slice(0, 12);

  const movable = limited.filter((stop) => !stop.pinned);
  let movableOrder = movable.map((stop) => stop.appel.id);

  try {
    if (movable.length >= 2) {
      const optimized = await fetchRoute({
        start: tech.start,
        end: tech.end || tech.start,
        stops: movable.map((stop) => ({
          address: stop.appel.adresse,
          minutesOnSite: stop.minutesOnSite,
        })),
        optimize: true,
      });
      movableOrder = optimized.waypointOrder
        .map((index) => movable[index]?.appel.id)
        .filter((id): id is string => Boolean(id));
      if (movableOrder.length === 0) {
        movableOrder = movable.map((stop) => stop.appel.id);
      }
    }

    const { ordered: merged } = mergePinnedOptimal(
      limited,
      movableOrder,
      tech.startHour,
      ROAD_WINDOW.softEnd,
      true,
    );

    const google = await fetchRoute({
      start: tech.start,
      end: tech.end || tech.start,
      stops: merged.map((stop) => ({
        address: stop.appel.adresse,
        minutesOnSite: stop.minutesOnSite,
      })),
      optimize: false,
      departureTime: new Date().toISOString(),
    });

    return { tech, stops: merged, google, error: null };
  } catch (err) {
    const { ordered: merged } = mergePinnedOptimal(
      limited,
      movableOrder,
      tech.startHour,
      ROAD_WINDOW.softEnd,
      true,
    );
    return {
      tech,
      stops: merged,
      google: null,
      error:
        err instanceof Error
          ? err.message
          : "Google n'a pas pu calculer cette tournée.",
    };
  }
}

function Workspace() {
  const [calls, setCalls] = useState<Appel[]>([]);
  const [techs, setTechs] = useState<Tech[]>(() => createBlankRoster());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<"demo" | "netsuite" | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const [date, setDate] = useState(todayIsoDate);
  const [moveAssigned, setMoveAssigned] = useState<boolean | null>(null);
  const [pmQuota, setPmQuota] = useState("");
  const [reactifDuration, setReactifDuration] = useState("");
  const [preventifDuration, setPreventifDuration] = useState("");
  const [filter, setFilter] = useState<"all" | CallType | "overdue">("all");
  const [plannedOnly, setPlannedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [routes, setRoutes] = useState<TechRoute[] | null>(null);
  const [unassigned, setUnassigned] = useState<Unassigned[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [allowOvertime, setAllowOvertime] = useState<boolean | null>(null);
  const [overtimeWarnings, setOvertimeWarnings] = useState<OvertimeWarning[]>(
    [],
  );
  const [overtimeIgnored, setOvertimeIgnored] = useState(false);
  const [presenceTouched, setPresenceTouched] = useState<Set<string>>(
    () => new Set(["5", "12", "18", "21"]),
  );
  const [skillsTouched, setSkillsTouched] = useState<Set<string>>(
    () => new Set(),
  );
  const [suggestionReady, setSuggestionReady] = useState(false);
  const [remoteTrips, setRemoteTrips] = useState<RemoteTrip[]>([]);
  const [planDays, setPlanDays] = useState<Array<{ date: string; routes: TechRoute[] }>>(
    [],
  );
  const [activePlanDate, setActivePlanDate] = useState("");
  const [planSource, setPlanSource] = useState<"vrp" | "heuristic" | null>(null);
  const [planStats, setPlanStats] = useState<PlanStats | null>(null);
  const activeDateRef = useRef("");
  const horizonRef = useRef<Array<{ date: string; routes: TechRoute[] }>>([]);
  const planSourceRef = useRef(planSource);
  useEffect(() => {
    planSourceRef.current = planSource;
  }, [planSource]);
  const commitRoutes = useCallback((next: TechRoute[]) => {
    setRoutes(next);
    if (planSourceRef.current !== "vrp") return;
    const date = activeDateRef.current;
    if (!date) return;
    const horizon = horizonRef.current.map((day) =>
      day.date === date ? { ...day, routes: next } : day,
    );
    horizonRef.current = horizon;
    setPlanDays(horizon);
  }, []);
  const [refusedSuggestionIds, setRefusedSuggestionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [techPanelOpen, setTechPanelOpen] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const effectiveDate = date || todayIsoDate();
  const emptyRoutes = useMemo<TechRoute[]>(
    () =>
      techs
        .filter((tech) => tech.present)
        .map((tech) => ({
          tech: {
            ...tech,
            startHour: tech.startHour || ROAD_WINDOW.start,
            endHour: tech.endHour || ROAD_WINDOW.softEnd,
            start: tech.start || DRUMMONDVILLE_HQ,
            end: tech.end || tech.start || DRUMMONDVILLE_HQ,
          },
          stops: [],
          google: null,
          error: null,
        })),
    [techs],
  );
  // Keep calendar columns even if generate once set routes to [].
  const displayRoutes =
    routes && routes.length > 0 ? routes : emptyRoutes;
  const durations = useMemo(
    () => parseDurations(reactifDuration, preventifDuration),
    [reactifDuration, preventifDuration],
  );
  const pmQuotaNumber = Number(pmQuota) || 0;

  const businessDaysLeft = useMemo(
    () => countBusinessDays(effectiveDate, QUARTER.deadline),
    [effectiveDate],
  );
  const avgPreventifPerDay = useMemo(
    () => preventifPerBusinessDay(effectiveDate),
    [effectiveDate],
  );

  useEffect(() => {
    let cancelled = false;
    loadAppels()
      .then((loaded) => {
        if (cancelled) return;
        if (loaded.source === "netsuite") {
          setCalls(loaded.appels);
          if (loaded.techs) {
            setTechs(loaded.techs);
            setPresenceTouched(new Set());
          }
        } else {
          setCalls(blankCallAssignments(loaded.appels));
        }
        setDataSource(loaded.source);
        if (loaded.warning) setLoadError(loaded.warning);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "Chargement impossible",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reactifPendingCount = useMemo(
    () =>
      calls.filter(
        (item) =>
          item.type === "reactif" && !isReactifOverdue(item, effectiveDate),
      ).length,
    [calls, effectiveDate],
  );
  const reactifOverdueCount = useMemo(
    () => calls.filter((item) => isReactifOverdue(item, effectiveDate)).length,
    [calls, effectiveDate],
  );

  const preventifSuggestions = useMemo(() => {
    if (planSource === "vrp") return [];
    if (!displayRoutes.some((route) => route.stops.length > 0)) return [];
    const assignedIds = new Set(
      displayRoutes.flatMap((route) =>
        route.stops.map((stop) => stop.appel.id),
      ),
    );
    const candidates = calls.filter(
      (appel) =>
        appel.type === "preventif" &&
        !appel.planifie &&
        !assignedIds.has(appel.id) &&
        !refusedSuggestionIds.has(appel.id),
    );
    return suggestPreventifs({
      routes: displayRoutes,
      candidates,
      durations,
      maxPerTech: 6,
    });
  }, [displayRoutes, calls, durations, refusedSuggestionIds, planSource]);

  const calendarAppelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const route of displayRoutes) {
      for (const stop of route.stops) ids.add(stop.appel.id);
    }
    return ids;
  }, [displayRoutes]);

  const syncPlannedPin = useCallback(
    async (appel: Appel) => {
      const baseRoutes =
        routes && routes.length > 0
          ? routes
          : emptyRoutes.length > 0
            ? emptyRoutes
            : null;
      if (!baseRoutes) return;

      // Remove from calendar when unplanned or missing time
      if (!appel.planifie || !appel.heure) {
        if (!routes) return;
        const has = routes.some((route) =>
          route.stops.some((stop) => stop.appel.id === appel.id),
        );
        if (!has) return;
        const nextRoutes = await Promise.all(
          routes.map(async (route) => {
            const nextStops = route.stops.filter(
              (stop) => stop.appel.id !== appel.id,
            );
            if (nextStops.length === route.stops.length) return route;
            if (nextStops.length === 0) {
              return {
                tech: route.tech,
                stops: [],
                google: null,
                error: null,
              };
            }
            return buildTechRoute(route.tech, nextStops);
          }),
        );
        commitRoutes(nextRoutes);
        setOvertimeWarnings(evaluateRoadWindow(nextRoutes));
        return;
      }

      const techId =
        appel.techId || techs.find((tech) => tech.present)?.id || "";
      if (!techId) return;
      const rosterTech = techs.find((tech) => tech.id === techId);
      if (!rosterTech?.present) return;

      const tech: Tech = {
        ...rosterTech,
        startHour: rosterTech.startHour || ROAD_WINDOW.start,
        endHour: rosterTech.endHour || ROAD_WINDOW.softEnd,
        start: rosterTech.start || DRUMMONDVILLE_HQ,
        end: rosterTech.end || rosterTech.start || DRUMMONDVILLE_HQ,
        skills:
          rosterTech.skills && rosterTech.skills.length > 0
            ? rosterTech.skills
            : [...ALL_SKILL_IDS],
      };

      setAcceptingId(appel.id);
      try {
        let nextRoutes = baseRoutes.map((route) => ({
          ...route,
          stops: route.stops.filter((stop) => stop.appel.id !== appel.id),
        }));
        if (!nextRoutes.some((route) => route.tech.id === techId)) {
          nextRoutes = [
            ...nextRoutes,
            { tech, stops: [], google: null, error: null },
          ];
        }

        const target = nextRoutes.find((route) => route.tech.id === techId);
        if (!target) return;

        const newStop: DayStop = {
          appel: { ...appel, planifie: true, heure: appel.heure, techId },
          minutesOnSite: onSiteMinutes(appel.type, durations),
          pinned: true,
        };
        const rebuilt = await buildTechRoute(
          { ...target.tech, ...tech },
          [...target.stops, newStop],
        );
        nextRoutes = nextRoutes.map((route) =>
          route.tech.id === techId ? rebuilt : route,
        );
        commitRoutes(nextRoutes);
        setUnassigned((current) =>
          current.filter((item) => item.appel.id !== appel.id),
        );
        setOvertimeWarnings(evaluateRoadWindow(nextRoutes));
        setToast(
          `${appel.magasin} → calendrier · ${tech.name} · ${appel.heure}`,
        );
      } finally {
        setAcceptingId(null);
      }
    },
    [routes, emptyRoutes, techs, durations, commitRoutes],
  );

  const updateCall = useCallback(
    (id: string, patch: Partial<Appel>) => {
      setCalls((current) => {
        const nextCalls = current.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        );
        const updated = nextCalls.find((item) => item.id === id);
        if (
          updated &&
          ("planifie" in patch || "heure" in patch || "techId" in patch)
        ) {
          window.queueMicrotask(() => {
            void syncPlannedPin(updated);
          });
        }
        return nextCalls;
      });
    },
    [syncPlannedPin],
  );

  const updateTech = useCallback((id: string, patch: Partial<Tech>) => {
    if ("present" in patch) {
      setPresenceTouched((current) => new Set(current).add(id));
    }
    if ("skills" in patch) {
      setSkillsTouched((current) => new Set(current).add(id));
    }
    setTechs((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const addTech = useCallback(() => {
    const id = String(70 + techs.length);
    setTechs((current) => [
      ...current,
      {
        ...createBlankRoster()[0],
        id,
        name: `Technicien ${id}`,
        present: false,
      },
    ]);
  }, [techs.length]);

  async function applySuggestion() {
    setError(null);
    setToast(null);
    if (calls.length === 0) {
      setError("Liste d'appels encore vide. Attendez la fin du chargement.");
      return;
    }

    const result = suggestPlannerFields({
      inputs: {
        date,
        pmQuota,
        reactifDuration,
        preventifDuration,
        moveAssigned,
        allowOvertime,
      },
      techs,
      calls,
      presenceTouched,
      skillsTouched,
    });

    setDate(result.date);
    setPmQuota(result.pmQuota);
    setReactifDuration(result.reactifDuration);
    setPreventifDuration(result.preventifDuration);
    setMoveAssigned(result.moveAssigned);
    setAllowOvertime(result.allowOvertime);
    setTechs(result.techs);
    setCalls(result.calls);
    setSuggestionReady(true);

    await rebuildDay({
      workingCalls: result.calls,
      workingTechs: result.techs,
      planDate: result.date,
      quota:
        Number(result.pmQuota) ||
        Math.ceil(preventifPerBusinessDay(result.date)),
      durations: parseDurations(
        result.reactifDuration,
        result.preventifDuration,
      ),
      overtimeAllowed: result.allowOvertime === true,
      moveAssigned: result.moveAssigned,
      toastPrefix: `Suggestion + tournées : ${result.summary.join(" · ")}`,
    });
  }

  const acceptSuggestion = useCallback(
    async (suggestion: PreventifSuggestion) => {
      if (!routes || acceptingId) return;
      const route = routes.find((item) => item.tech.id === suggestion.techId);
      if (!route) return;

      setAcceptingId(suggestion.appel.id);
      setProgress(`Ajout du préventif sur ${route.tech.name}…`);
      setToast(null);
      setError(null);

      try {
        const newStop: DayStop = {
          appel: { ...suggestion.appel, techId: suggestion.techId },
          minutesOnSite: suggestion.minutesOnSite,
          pinned: false,
        };
        const nextStops = [...route.stops];
        const insertAt = Math.max(
          0,
          Math.min(suggestion.insertAfterIndex + 1, nextStops.length),
        );
        nextStops.splice(insertAt, 0, newStop);

        const rebuilt = await buildTechRoute(route.tech, nextStops);
        const nextRoutes = (routes ?? []).map((item) =>
          item.tech.id === route.tech.id ? rebuilt : item,
        );
        commitRoutes(nextRoutes);
        setUnassigned((current) =>
          current.filter((item) => item.appel.id !== suggestion.appel.id),
        );
        const warnings = evaluateRoadWindow(nextRoutes);
        setOvertimeWarnings(warnings);
        if (warnings.length > 0 && !overtimeIgnored && allowOvertime !== true) {
          setToast(
            `Préventif ajouté — attention : dépasse ${ROAD_WINDOW.softEndLabel}.`,
          );
        } else {
          setToast(
            `Préventif ajouté à ${route.tech.name} — ${suggestion.appel.magasin}`,
          );
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Impossible d'ajouter la suggestion.",
        );
      } finally {
        setAcceptingId(null);
        setProgress(null);
      }
    },
    [routes, acceptingId, overtimeIgnored, allowOvertime, commitRoutes],
  );

  const acceptAllSuggestions = useCallback(async () => {
    if (!routes || acceptingId || preventifSuggestions.length === 0) return;

    setAcceptingId("__all__");
    setProgress(`Acceptation de ${preventifSuggestions.length} suggestion(s)…`);
    setToast(null);
    setError(null);

    try {
      const byTech = new Map<string, PreventifSuggestion[]>();
      for (const suggestion of preventifSuggestions) {
        const list = byTech.get(suggestion.techId) ?? [];
        list.push(suggestion);
        byTech.set(suggestion.techId, list);
      }

      let nextRoutes = [...routes];
      const acceptedIds = new Set<string>();

      for (const [techId, list] of byTech) {
        const route = nextRoutes.find((item) => item.tech.id === techId);
        if (!route) continue;
        const ordered = [...list].sort(
          (a, b) => a.suggestedStartMin - b.suggestedStartMin,
        );
        const nextStops = [...route.stops];
        for (const suggestion of ordered) {
          const newStop: DayStop = {
            appel: { ...suggestion.appel, techId },
            minutesOnSite: suggestion.minutesOnSite,
            pinned: false,
          };
          const insertAt = Math.max(
            0,
            Math.min(suggestion.insertAfterIndex + 1, nextStops.length),
          );
          nextStops.splice(insertAt, 0, newStop);
          acceptedIds.add(suggestion.appel.id);
        }
        const rebuilt = await buildTechRoute(route.tech, nextStops);
        nextRoutes = nextRoutes.map((item) =>
          item.tech.id === techId ? rebuilt : item,
        );
      }

      commitRoutes(nextRoutes);
      setUnassigned((current) =>
        current.filter((item) => !acceptedIds.has(item.appel.id)),
      );
      setOvertimeWarnings(evaluateRoadWindow(nextRoutes));
      setToast(
        `${acceptedIds.size} suggestion(s) ajoutée(s) aux horaires.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossible d'accepter les suggestions.",
      );
    } finally {
      setAcceptingId(null);
      setProgress(null);
    }
  }, [routes, acceptingId, preventifSuggestions, commitRoutes]);

  const refuseSuggestion = useCallback((suggestion: PreventifSuggestion) => {
    setRefusedSuggestionIds((current) => {
      const next = new Set(current);
      next.add(suggestion.appel.id);
      return next;
    });
    setToast(`Suggestion refusée — ${suggestion.appel.magasin}`);
  }, []);

  const refuseAllSuggestions = useCallback(() => {
    if (preventifSuggestions.length === 0) return;
    setRefusedSuggestionIds((current) => {
      const next = new Set(current);
      for (const suggestion of preventifSuggestions) {
        next.add(suggestion.appel.id);
      }
      return next;
    });
    setToast(
      `${preventifSuggestions.length} suggestion(s) refusée(s) pour aujourd’hui.`,
    );
  }, [preventifSuggestions]);

  const removeStop = useCallback(
    async (techId: string, appelId: string) => {
      if (!routes || removingId) return;
      const route = routes.find((item) => item.tech.id === techId);
      if (!route) return;
      const removed = route.stops.find((stop) => stop.appel.id === appelId);
      if (!removed) return;

      setRemovingId(appelId);
      setProgress(`Retrait de ${removed.appel.magasin}…`);
      setError(null);

      try {
        const nextStops = route.stops.filter(
          (stop) => stop.appel.id !== appelId,
        );
        const rebuilt =
          nextStops.length === 0
            ? { tech: route.tech, stops: [], google: null, error: null }
            : await buildTechRoute(route.tech, nextStops);

        const nextRoutes = (routes ?? []).map((item) =>
          item.tech.id === techId ? rebuilt : item,
        );
        commitRoutes(nextRoutes);
        setUnassigned((current) => [
          {
            appel: removed.appel,
            reason: "Retiré du calendrier",
          },
          ...current.filter((item) => item.appel.id !== appelId),
        ]);
        if (removed.pinned || removed.appel.planifie) {
          setCalls((current) =>
            current.map((item) =>
              item.id === appelId
                ? { ...item, planifie: false, heure: "", techId: "" }
                : item,
            ),
          );
        }
        setOvertimeWarnings(evaluateRoadWindow(nextRoutes));
        setToast(`${removed.appel.magasin} retiré de l'horaire.`);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Impossible de retirer cet arrêt.",
        );
      } finally {
        setRemovingId(null);
        setProgress(null);
      }
    },
    [routes, removingId, commitRoutes],
  );

  const ignoreOvertimeWarning = useCallback(() => {
    setOvertimeIgnored(true);
    setAllowOvertime(true);
    setToast(
      `Avertissement 8 h–${ROAD_WINDOW.softEndLabel} ignoré — tournées conservées.`,
    );
  }, []);

  const trimOvertimeRoutes = useCallback(async () => {
    if (!routes) return;
    setLoading(true);
    setProgress("Raccourcissement des tournées…");
    try {
      const removedAll: DayStop[] = [];
      const trimmed = routes.map((route) => {
        const result = trimToSoftEnd(route.tech, route.stops);
        removedAll.push(...result.removed);
        return { ...route, stops: result.stops };
      });

      const rebuilt = await Promise.all(
        trimmed.map(async (route) => {
          if (route.stops.length === 0) {
            return { ...route, google: null, error: null };
          }
          return buildTechRoute(route.tech, route.stops);
        }),
      );
      commitRoutes(rebuilt);
      if (removedAll.length > 0) {
        setUnassigned((current) => [
          ...removedAll.map((stop) => ({
            appel: stop.appel,
            reason: `Retiré pour respecter ${ROAD_WINDOW.softEndLabel}`,
          })),
          ...current,
        ]);
      }
      setOvertimeWarnings(evaluateRoadWindow(rebuilt));
      setOvertimeIgnored(false);
      setToast(
        removedAll.length > 0
          ? `${removedAll.length} arrêt(s) retirés pour finir avant ${ROAD_WINDOW.softEndLabel}.`
          : `Impossible de raccourcir davantage (planifiés fixes).`,
      );
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [routes, commitRoutes]);

  async function sendToNetsuite() {
    if (sending) return;
    const items = (routes ?? []).flatMap((route) =>
      route.stops.map((stop) => {
        const caseId = /^\d+$/.test(stop.appel.netsuiteId)
          ? stop.appel.netsuiteId
          : undefined;
        return {
          taskId: stop.appel.id,
          techId: route.tech.id,
          date: activePlanDate || effectiveDate,
          heure: stop.appel.heure || undefined,
          status: "NOTSTART" as const,
          caseId,
          caseStatus: caseId ? "1" : undefined,
        };
      }),
    );
    if (items.length === 0) {
      setToast("Aucun arrêt à envoyer. Planifiez la journée d'abord.");
      setError(null);
      return;
    }

    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/netsuite/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items),
      });
      const data = (await response.json()) as {
        error?: string;
        updated?: number;
        failed?: number;
      };
      if (!response.ok) {
        throw new Error(data.error || "Envoi NetSuite refusé.");
      }
      setToast(
        data.failed
          ? `${data.updated ?? 0} tâche(s) mises à jour, ${data.failed} échec(s).`
          : `${data.updated ?? items.length} tâche(s) envoyées à NetSuite (sandbox).`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Envoi NetSuite impossible.",
      );
    } finally {
      setSending(false);
    }
  }

  async function rebuildDay(options?: {
    workingCalls?: Appel[];
    workingTechs?: Tech[];
    planDate?: string;
    quota?: number;
    durations?: { preventif: number; reactif: number };
    overtimeAllowed?: boolean;
    moveAssigned?: boolean;
    toastPrefix?: string;
  }) {
    setError(null);
    setOvertimeIgnored(false);
    setOvertimeWarnings([]);

    const workingCalls = options?.workingCalls ?? calls;
    const sourceTechs = options?.workingTechs ?? techs;
    const planDate = options?.planDate || date || todayIsoDate();
    const overtimeAllowed =
      options?.overtimeAllowed ?? allowOvertime === true;
    const dayDurations = options?.durations ?? durations;
    const quota =
      options?.quota ??
      (pmQuotaNumber > 0 ? pmQuotaNumber : Math.ceil(avgPreventifPerDay));

    if (workingCalls.length === 0) {
      setError("Liste d'appels encore vide. Attendez la fin du chargement.");
      return;
    }

    const readyTechs = sourceTechs.map((tech) => ({
      ...tech,
      startHour: tech.startHour || ROAD_WINDOW.start,
      endHour: tech.endHour || ROAD_WINDOW.softEnd,
      start: tech.start || DRUMMONDVILLE_HQ,
      end: tech.end || tech.start || DRUMMONDVILLE_HQ,
      skills:
        tech.skills && tech.skills.length > 0
          ? tech.skills
          : [...ALL_SKILL_IDS],
    }));

    if (!readyTechs.some((tech) => tech.present)) {
      setError(
        "Aucun technicien présent. Utilisez « Générer une suggestion » ou cochez Présent.",
      );
      return;
    }

    setTechs(readyTechs);

    let callsForDay = workingCalls;
    const missingTime = callsForDay.filter(
      (item) => item.planifie && !item.heure,
    );
    if (missingTime.length > 0) {
      callsForDay = callsForDay.map((item) =>
        item.planifie && !item.heure ? { ...item, heure: "10:00" } : item,
      );
      setCalls(callsForDay);
    }

    setLoading(true);
    setProgress("Optimisation des tournées (8 h–17 h, 5 jours)…");

    const canMove = options?.moveAssigned ?? moveAssigned === true;
    const enrichPlanDay = async (date: string, draft: TechRoute[]) => {
      const enriched = await Promise.all(
        draft.map(async (route) => {
          if (route.stops.length === 0) return route;
          try {
            const google = await fetchRoute({
              start: route.tech.start,
              end: route.tech.end || route.tech.start,
              stops: route.stops.map((stop) => ({
                address: stop.appel.adresse,
                minutesOnSite: stop.minutesOnSite,
              })),
              optimize: false,
              departureTime: new Date().toISOString(),
            });
            return { ...route, google, error: null };
          } catch {
            return route;
          }
        }),
      );
      const next = horizonRef.current.map((day) => {
        if (day.date !== date) return day;
        return {
          ...day,
          routes: day.routes.map((route) => {
            const update = enriched.find((item) => item.tech.id === route.tech.id);
            if (!update?.google) return route;
            const same =
              route.stops.map((stop) => stop.appel.id).join() ===
              update.stops.map((stop) => stop.appel.id).join();
            return same ? { ...route, google: update.google, error: null } : route;
          }),
        };
      });
      horizonRef.current = next;
      setPlanDays(next);
      if (activeDateRef.current === date) {
        setRoutes(next.find((day) => day.date === date)?.routes ?? draft);
      }
    };

    try {
      try {
        const response = await fetch("/api/dispatch-v2/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            calls: callsForDay,
            techs: readyTechs,
            date: planDate,
            horizonDays: 5,
            pmQuota: quota,
            durations: dayDurations,
            allowOvertime: overtimeAllowed,
            moveAssigned: canMove,
          }),
        });
        if (response.ok) {
          const plan = (await response.json()) as PlanResponse;
          const horizon = plan.days.map((day) => ({
            date: day.date,
            routes: toTechRoutes(day, readyTechs, plan.stats.travelSource),
          }));
          const selected =
            horizon.find((day) => day.date === planDate) ?? horizon[0];
          horizonRef.current = horizon;
          activeDateRef.current = selected?.date ?? "";
          planSourceRef.current = "vrp";
          setPlanSource("vrp");
          setPlanDays(horizon);
          setActivePlanDate(selected?.date ?? "");
          setRoutes(selected?.routes ?? []);
          setUnassigned(plan.unassigned);
          setRemoteTrips(plan.remoteTrips ?? []);
          setPlanStats(plan.stats);
          setOvertimeWarnings([]);
          setOvertimeIgnored(false);
          const travelLabel = plan.stats.travelWarning
            ? plan.stats.travelWarning
            : plan.stats.travelSource === "haversine"
              ? "temps estimés"
              : "temps Google";
          const prefix = options?.toastPrefix ? `${options.toastPrefix} — ` : "";
          setToast(
            `${prefix}${plan.stats.served} arrêts sur ${plan.days.length} jour(s), ${formatHoursFr(plan.stats.driveMin)} de route (${travelLabel}). ${plan.stats.remoteCalls} appel(s) en voyage dédié.`,
          );
          window.requestAnimationFrame(() => {
            resultsRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          });
          if (selected && selected.routes.some((route) => route.stops.length > 0)) {
            void enrichPlanDay(selected.date, selected.routes);
          }
          return;
        }
      } catch {
        // L'heuristique historique garde la démo utilisable si l'optimiseur échoue.
      }

      planSourceRef.current = "heuristic";
      setPlanSource("heuristic");
      setRemoteTrips([]);
      setPlanDays([]);
      setPlanStats(null);
      setActivePlanDate("");
      activeDateRef.current = "";
      const assigned = optimizeDay({
        calls: callsForDay,
        techs: readyTechs,
        pmQuota: quota,
        durations: dayDurations,
        asOfDate: planDate,
        allowOvertime: overtimeAllowed,
      });
      setUnassigned(assigned.unassigned);

      const present = readyTechs.filter((tech) => tech.present);
      const mergeLeftovers: DayStop[] = [];
      const draft: TechRoute[] = present.map((tech) => {
        const raw = (assigned.byTech[tech.id] ?? []).slice(0, 12);
        const movable = raw.filter((stop) => !stop.pinned);
        const { ordered, leftover } = mergePinnedOptimal(
          raw,
          movable.map((stop) => stop.appel.id),
          tech.startHour,
          ROAD_WINDOW.softEnd,
          overtimeAllowed,
        );
        mergeLeftovers.push(...leftover);
        return { tech, stops: ordered, google: null, error: null };
      });

      if (mergeLeftovers.length > 0) {
        setUnassigned([
          ...assigned.unassigned,
          ...mergeLeftovers.map((stop) => ({
            appel: stop.appel,
            reason: `Hors fenêtre 8 h–${ROAD_WINDOW.softEndLabel}`,
          })),
        ]);
      }

      setRoutes(draft);
      window.requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });

      const withStops = draft.filter((route) => route.stops.length > 0);
      if (withStops.length === 0) {
        setError(
          "Aucun arrêt assigné. Vérifiez les techniciens présents, les compétences et le quota préventif.",
        );
        return;
      }

      setProgress(
        `Optimisation Google Maps pour ${withStops.length} technicien(s)…`,
      );

      const googleRoutes = await Promise.all(
        draft.map(async (route) => {
          if (route.stops.length === 0) return route;
          return buildTechRoute(route.tech, route.stops);
        }),
      );

      setRoutes(googleRoutes);

      const warnings = evaluateRoadWindow(googleRoutes);
      const mergedWarnings = [...assigned.earlyWarnings];
      for (const warning of warnings) {
        if (!mergedWarnings.some((item) => item.techId === warning.techId)) {
          mergedWarnings.push(warning);
        } else {
          const index = mergedWarnings.findIndex(
            (item) => item.techId === warning.techId,
          );
          mergedWarnings[index] = warning;
        }
      }
      setOvertimeWarnings(mergedWarnings);

      const failed = googleRoutes.filter((route) => route.error);
      const prefix = options?.toastPrefix
        ? `${options.toastPrefix} — `
        : "";
      if (failed.length > 0 && failed.length === withStops.length) {
        setError(
          `Google n'a pas renvoyé de routes (${failed[0]?.error}). Le calendrier affiche quand même l'horaire estimé.`,
        );
      } else if (mergedWarnings.length > 0 && !overtimeAllowed) {
        setToast(
          `${prefix}Calendrier à jour — ${mergedWarnings.length} tech(s) dépassent ${ROAD_WINDOW.softEndLabel}.`,
        );
      } else if (failed.length > 0) {
        setToast(
          `${prefix}${failed.length} tournée(s) sans trafic Google — horaires estimés.`,
        );
      } else {
        setToast(`${prefix}Calendrier et trajets Google mis à jour.`);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "La génération a échoué. Réessayez.",
      );
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  return (
    <div
      className={`gt gt-shell${displayRoutes.length > 0 ? " gt-shell-wide" : ""}`}
    >
      <header className="gt-header gt-header-compact">
        <div>
          <p className="gt-kicker">Dispatch v2</p>
          <h1>Planification de la journée</h1>
          <p
            className="gt-source"
            role="status"
            data-source={dataSource ?? "loading"}
          >
            {dataSource === "netsuite"
              ? "Données NetSuite (sandbox)"
              : dataSource === "demo"
                ? "Demo"
                : "Chargement des données"}
          </p>
        </div>
        <div className="gt-header-actions">
          <button
            type="button"
            className="gt-btn-ghost"
            onClick={() => setTechPanelOpen(true)}
          >
            Techniciens
          </button>
        </div>
      </header>

      <HelpGuide />

      {loadError ? <p className="gt-error">{loadError}</p> : null}

      <div className="gt-stats">
        <div className="gt-stat">
          <span>Préventifs restants d&apos;ici fin Q4</span>
          <strong>{QUARTER.quarterTarget}</strong>
          <em>
            {QUARTER.yearTarget} / 4 · échéance {QUARTER.deadlineLabel}
          </em>
        </div>
        <div className="gt-stat">
          <span>Préventif à planifier / jour</span>
          <strong>{avgPreventifPerDay}</strong>
          <em>moyenne sur {businessDaysLeft} jours ouvrables restants</em>
        </div>
        <div className="gt-stat">
          <span>Réactif en attente (2 j)</span>
          <strong>{reactifPendingCount}</strong>
          <em>dans le délai de {SLA.reactif.delayDays} jours</em>
        </div>
        <div className="gt-stat gt-stat-alert">
          <span>Réactif délai dépassé</span>
          <strong>{reactifOverdueCount}</strong>
          <em>priorité immédiate</em>
        </div>
      </div>

      <div className="gt-sticky gt-sticky-top">
        <button
          type="button"
          className="gt-btn-ghost"
          onClick={() => void sendToNetsuite()}
          disabled={sending || loading}
        >
          {sending ? "Envoi…" : "Envoyer à NetSuite"}
        </button>
        <button
          type="button"
          className="gt-btn"
          onClick={() => void applySuggestion()}
          disabled={loading || calls.length === 0}
        >
          {loading ? progress || "Optimisation…" : "Générer une suggestion"}
        </button>
      </div>

      {error ? <p className="gt-error">{error}</p> : null}
      {toast ? <p className="gt-toast">{toast}</p> : null}
      {progress ? <p className="gt-toast">{progress}</p> : null}

      {displayRoutes.length > 0 ? (
        <div className="gt-split gt-split-top" ref={resultsRef}>
          <aside className="gt-split-calls">
            <CallList
              calls={calls}
              techs={techs}
              asOfDate={effectiveDate}
              filter={filter}
              plannedOnly={plannedOnly}
              search={search}
              onFilter={setFilter}
              onPlannedOnly={setPlannedOnly}
              onSearch={setSearch}
              onUpdate={updateCall}
              onCalendarIds={calendarAppelIds}
            />
          </aside>
          <div className="gt-split-calendar">
            <RouteBoard
              routes={displayRoutes}
              suggestions={preventifSuggestions}
              planDays={planDays.map((day) => ({
                date: day.date,
                label: formatDayLabel(day.date),
                stopCount: day.routes.reduce(
                  (count, route) => count + route.stops.length,
                  0,
                ),
              }))}
              activeDate={activePlanDate}
              onSelectDate={(nextDate) => {
                activeDateRef.current = nextDate;
                setActivePlanDate(nextDate);
                const day = horizonRef.current.find((item) => item.date === nextDate);
                if (day) setRoutes(day.routes);
              }}
              unassigned={unassigned}
              remoteTrips={remoteTrips}
              planSummary={
                planStats
                  ? `${planStats.served} arrêts tenus avant 17 h · ${formatHoursFr(planStats.driveMin)} de route · ${planStats.remoteCalls} appel(s) en voyage dédié`
                  : undefined
              }
              planWarning={planStats?.travelWarning}
              onAcceptSuggestion={acceptSuggestion}
              onRefuseSuggestion={refuseSuggestion}
              onAcceptAllSuggestions={acceptAllSuggestions}
              onRefuseAllSuggestions={refuseAllSuggestions}
              acceptingId={acceptingId}
              overtimeWarnings={overtimeWarnings}
              overtimeIgnored={overtimeIgnored || allowOvertime === true}
              onIgnoreOvertime={ignoreOvertimeWarning}
              onTrimOvertime={trimOvertimeRoutes}
              onRemoveStop={removeStop}
              removingId={removingId}
              onOpenTechPanel={() => setTechPanelOpen(true)}
              emptyHint={
                routes
                  ? undefined
                  : "Mode calendrier actif — Planifié ajoute l’arrêt tout de suite. Suggestion remplit le reste."
              }
            />
          </div>
        </div>
      ) : (
        <div className="gt-calls-solo">
          <CallList
            calls={calls}
            techs={techs}
            asOfDate={effectiveDate}
            filter={filter}
            plannedOnly={plannedOnly}
            search={search}
            onFilter={setFilter}
            onPlannedOnly={setPlannedOnly}
            onSearch={setSearch}
            onUpdate={updateCall}
            onCalendarIds={calendarAppelIds}
          />
          <p className="gt-section-empty">
            Aucun technicien présent — ouvrez le panneau Techniciens.
          </p>
        </div>
      )}

      <details className="gt-params-details">
        <summary>Paramètres du jour</summary>
        <section className="gt-panel" style={{ marginTop: "0.75rem" }}>
          <div className="gt-row">
            <label className="gt-field">
              <span>Date à planifier</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <fieldset className="gt-field">
              <span>Déplacer les tâches déjà attribuées ?</span>
              <label className="gt-check">
                <input
                  type="radio"
                  name="move"
                  checked={moveAssigned === false}
                  onChange={() => setMoveAssigned(false)}
                />
                Non
              </label>
              <label className="gt-check">
                <input
                  type="radio"
                  name="move"
                  checked={moveAssigned === true}
                  onChange={() => setMoveAssigned(true)}
                />
                Oui — n&apos;unlock pas les planifiés
              </label>
              {moveAssigned === null ? (
                <em style={{ color: "var(--gt-muted)", fontSize: "0.8rem" }}>
                  Non choisi — la suggestion proposera Non
                </em>
              ) : null}
            </fieldset>
            <label className="gt-field">
              <span>Entretiens préventifs à insérer</span>
              <input
                type="number"
                min={0}
                max={80}
                value={pmQuota}
                placeholder={`ex. ${Math.ceil(avgPreventifPerDay)} (ratio Q4)`}
                onChange={(event) => setPmQuota(event.target.value)}
              />
            </label>
            <label className="gt-field">
              <span>Durée réactif (min)</span>
              <input
                type="number"
                value={reactifDuration}
                placeholder="90"
                onChange={(event) => setReactifDuration(event.target.value)}
              />
            </label>
            <label className="gt-field">
              <span>Durée préventif (min)</span>
              <input
                type="number"
                value={preventifDuration}
                placeholder="60"
                onChange={(event) => setPreventifDuration(event.target.value)}
              />
            </label>
          </div>
          <p
            style={{ margin: 0, color: "var(--gt-muted)", fontSize: "0.88rem" }}
          >
            Réactif : délai {SLA.reactif.delayDays} j. Fenêtre route soft : 8 h–
            {ROAD_WINDOW.softEndLabel}.
          </p>
          <label className="gt-check" style={{ marginTop: "0.65rem" }}>
            <input
              type="checkbox"
              checked={allowOvertime === true}
              onChange={(event) => setAllowOvertime(event.target.checked)}
            />
            Autoriser les tournées après {ROAD_WINDOW.softEndLabel}
          </label>
        </section>
      </details>

      {techPanelOpen ? (
        <div className="gt-drawer-root">
          <button
            type="button"
            className="gt-drawer-backdrop"
            aria-label="Fermer"
            onClick={() => setTechPanelOpen(false)}
          />
          <aside className="gt-drawer" role="dialog" aria-label="Techniciens">
            <div className="gt-drawer-head">
              <h2>Techniciens</h2>
              <button
                type="button"
                className="gt-btn-ghost"
                onClick={() => setTechPanelOpen(false)}
              >
                Fermer
              </button>
            </div>
            <TechRoster
              techs={techs}
              onChange={updateTech}
              onAdd={addTech}
              defaultOpen
              hideToggle
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}

export function GuertechApp() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  if (!apiKey) {
    return (
      <div className="gt gt-shell">
        <p className="gt-error">
          Clé Google Maps manquante. Ajoutez NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
          dans .env.local.
        </p>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey} libraries={["places"]} language="fr-CA">
      <Workspace />
    </APIProvider>
  );
}
