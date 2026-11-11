"use client";

import { useMemo } from "react";
import { parseMinutes } from "@/lib/guertech/assign";
import type { PreventifSuggestion } from "@/lib/guertech/suggestions";
import { formatClock } from "@/lib/guertech/suggestions";
import type { DayStop, TechRoute } from "@/lib/guertech/types";

type CalendarItem =
  | {
      kind: "job";
      key: string;
      stop: DayStop;
      index: number;
      startMin: number;
      endMin: number;
      arriveLabel: string;
      leaveLabel: string;
    }
  | {
      kind: "travel";
      key: string;
      startMin: number;
      endMin: number;
      minutes: number;
      label: string;
    }
  | {
      kind: "suggestion";
      key: string;
      suggestion: PreventifSuggestion;
      startMin: number;
      endMin: number;
    };

type ScheduleCalendarProps = {
  routes: TechRoute[];
  suggestions: PreventifSuggestion[];
  selectedTechId?: string;
  onSelectTech?: (id: string) => void;
  onAcceptSuggestion?: (suggestion: PreventifSuggestion) => void;
  onRefuseSuggestion?: (suggestion: PreventifSuggestion) => void;
  onAcceptAllSuggestions?: () => void;
  onRefuseAllSuggestions?: () => void;
  acceptingId?: string | null;
  onRemoveStop?: (techId: string, appelId: string) => void;
  removingId?: string | null;
};

const DAY_START = 7 * 60;
const DAY_END = 18 * 60;
const RANGE = DAY_END - DAY_START;
const HOUR_MARKS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const DEFAULT_TRAVEL_MIN = 20;

function formatMin(total: number): string {
  const clamped = Math.max(0, Math.round(total));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function travelMinutesForLeg(route: TechRoute, stopIndex: number): number {
  const leg = route.google?.legs?.[stopIndex];
  if (leg && Number.isFinite(leg.durationSeconds) && leg.durationSeconds > 0) {
    return Math.max(1, Math.round(leg.durationSeconds / 60));
  }
  const estimated = route.stops[stopIndex]?.driveMin;
  if (estimated != null && estimated >= 0) return Math.round(estimated);
  return DEFAULT_TRAVEL_MIN;
}

function buildTimeline(
  route: TechRoute,
  techSuggestions: PreventifSuggestion[],
): CalendarItem[] {
  const items: CalendarItem[] = [];
  let cursor = parseMinutes(route.tech.startHour || "08:00");

  route.stops.forEach((stop, index) => {
    const driveMin = travelMinutesForLeg(route, index);
    if (driveMin > 0) {
      items.push({
        kind: "travel",
        key: `travel-${route.tech.id}-${index}`,
        startMin: cursor,
        endMin: cursor + driveMin,
        minutes: driveMin,
        label: route.google?.legs?.[index]?.durationText
          ? `Trajet ${route.google.legs[index].durationText}`
          : route.stops[index]?.driveKm
            ? `Trajet ${driveMin} min · ${route.stops[index].driveKm} km`
            : `Trajet ~${driveMin} min`,
      });
      cursor += driveMin;
    }

    let startMin = cursor;
    if (stop.pinned && stop.appel.heure) {
      const pin = parseMinutes(stop.appel.heure);
      if (pin > startMin) startMin = pin;
    }

    const endMin = startMin + stop.minutesOnSite;
    items.push({
      kind: "job",
      key: stop.appel.id,
      stop,
      index,
      startMin,
      endMin,
      arriveLabel: formatMin(startMin),
      leaveLabel: formatMin(endMin),
    });
    cursor = endMin;
  });

  const returnLeg = route.google?.legs?.[route.stops.length];
  const returnMin =
    returnLeg && returnLeg.durationSeconds > 0
      ? Math.max(1, Math.round(returnLeg.durationSeconds / 60))
      : route.returnDriveMin != null && route.returnDriveMin > 0
        ? Math.round(route.returnDriveMin)
        : 0;
  if (returnMin > 0) {
    const returnKm = route.returnDriveKm ? ` · ${route.returnDriveKm} km` : "";
    items.push({
      kind: "travel",
      key: `travel-return-${route.tech.id}`,
      startMin: cursor,
      endMin: cursor + returnMin,
      minutes: returnMin,
      label: returnLeg?.durationText
        ? `Retour dépôt · ${returnLeg.durationText}`
        : `Retour dépôt · ${returnMin} min${returnKm}`,
    });
  }

  for (const suggestion of techSuggestions) {
    const startMin = suggestion.suggestedStartMin;
    const endMin = startMin + suggestion.minutesOnSite;
    items.push({
      kind: "suggestion",
      key: `sug-${suggestion.appel.id}`,
      suggestion,
      startMin,
      endMin,
    });
  }

  return items;
}

function topPct(startMin: number): number {
  return (
    ((Math.max(DAY_START, Math.min(DAY_END, startMin)) - DAY_START) / RANGE) *
    100
  );
}

function heightPct(startMin: number, endMin: number): number {
  const start = Math.max(DAY_START, startMin);
  const end = Math.min(DAY_END, Math.max(start + 12, endMin));
  return ((end - start) / RANGE) * 100;
}

export function ScheduleCalendar({
  routes,
  suggestions,
  selectedTechId,
  onSelectTech,
  onAcceptSuggestion,
  onRefuseSuggestion,
  onAcceptAllSuggestions,
  onRefuseAllSuggestions,
  acceptingId = null,
  onRemoveStop,
  removingId = null,
}: ScheduleCalendarProps) {
  const columns = routes;

  const byTech = useMemo(() => {
    const map = new Map<string, PreventifSuggestion[]>();
    for (const suggestion of suggestions) {
      const list = map.get(suggestion.techId) ?? [];
      list.push(suggestion);
      map.set(suggestion.techId, list);
    }
    return map;
  }, [suggestions]);

  if (columns.length === 0) {
    return (
      <p className="gt-section-empty">
        Aucun technicien présent à afficher dans le calendrier.
      </p>
    );
  }

  return (
    <div className="gt-cal-wrap">
      {suggestions.length > 0 ? (
        <div className="gt-suggest-banner">
          <div className="gt-suggest-banner-copy">
            <strong>{suggestions.length} suggestion(s) préventif</strong>
            <span>
              Urgence puis proximité — créneaux libres pour maximiser la
              journée.
            </span>
          </div>
          <div className="gt-suggest-banner-actions">
            <button
              type="button"
              className="gt-btn gt-accept-all-btn"
              disabled={Boolean(acceptingId)}
              onClick={() => onAcceptAllSuggestions?.()}
            >
              {acceptingId === "__all__"
                ? "Acceptation…"
                : `Tout accepter (${suggestions.length})`}
            </button>
            <button
              type="button"
              className="gt-btn-ghost"
              disabled={Boolean(acceptingId)}
              onClick={() => onRefuseAllSuggestions?.()}
            >
              Tout refuser
            </button>
          </div>
        </div>
      ) : null}

      <div className="gt-cal">
        <div className="gt-cal-hours" aria-hidden>
          {HOUR_MARKS.map((hour) => (
            <div
              key={hour}
              className="gt-cal-hour"
              style={{ top: `${((hour * 60 - DAY_START) / RANGE) * 100}%` }}
            >
              {String(hour).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        <div
          className="gt-cal-columns"
          style={{
            gridTemplateColumns: `repeat(${columns.length}, minmax(10.5rem, 1fr))`,
          }}
        >
          {columns.map((route) => {
            const techSuggestions = byTech.get(route.tech.id) ?? [];
            const items = buildTimeline(route, techSuggestions);
            const selected = route.tech.id === selectedTechId;
            const jobCount = items.filter((item) => item.kind === "job").length;
            return (
              <div
                key={route.tech.id}
                className={`gt-cal-col${selected ? " on" : ""}`}
              >
                <button
                  type="button"
                  className="gt-cal-col-head"
                  onClick={() => onSelectTech?.(route.tech.id)}
                >
                  <strong>{route.tech.name}</strong>
                  <span>
                    {jobCount} arrêt{jobCount > 1 ? "s" : ""}
                    {techSuggestions.length
                      ? ` · ${techSuggestions.length} suggestion(s)`
                      : ""}
                    {route.totalDriveMin
                      ? ` · ${route.totalDriveMin} min · ${route.totalDriveKm ?? 0} km`
                      : route.google
                        ? " · trafic Google"
                        : " · estimé"}
                  </span>
                </button>
                <div className="gt-cal-day">
                  {HOUR_MARKS.map((hour) => (
                    <div
                      key={hour}
                      className="gt-cal-gridline"
                      style={{
                        top: `${((hour * 60 - DAY_START) / RANGE) * 100}%`,
                      }}
                    />
                  ))}
                  {items.map((item) => {
                    if (item.kind === "travel") {
                      const h = heightPct(item.startMin, item.endMin);
                      if (h < 1.2) return null;
                      return (
                        <div
                          key={item.key}
                          className="gt-cal-travel"
                          style={{
                            top: `${topPct(item.startMin)}%`,
                            height: `${h}%`,
                          }}
                          title={item.label}
                        >
                          <span>{item.label}</span>
                        </div>
                      );
                    }

                    if (item.kind === "suggestion") {
                      return (
                        <div
                          key={item.key}
                          className="gt-cal-suggest"
                          style={{
                            top: `${topPct(item.startMin)}%`,
                            height: `${Math.max(6, heightPct(item.startMin, item.endMin))}%`,
                          }}
                        >
                          <span className="gt-cal-event-time">
                            Suggestion · {formatClock(item.startMin)}
                          </span>
                          <span className="gt-cal-event-title">
                            {item.suggestion.appel.magasin}
                          </span>
                          <span className="gt-cal-event-meta">
                            {item.suggestion.reason}
                          </span>
                          <div className="gt-suggest-actions">
                            <button
                              type="button"
                              className="gt-suggest-btn"
                              disabled={Boolean(acceptingId)}
                              onClick={(event) => {
                                event.stopPropagation();
                                onAcceptSuggestion?.(item.suggestion);
                              }}
                            >
                              {acceptingId === item.suggestion.appel.id
                                ? "Ajout…"
                                : "Accepter"}
                            </button>
                            <button
                              type="button"
                              className="gt-suggest-btn refuse"
                              disabled={Boolean(acceptingId)}
                              onClick={(event) => {
                                event.stopPropagation();
                                onRefuseSuggestion?.(item.suggestion);
                              }}
                            >
                              Refuser
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={item.key}
                        className={`gt-cal-event ${item.stop.appel.type}${
                          item.stop.pinned ? " pinned" : ""
                        }`}
                        style={{
                          top: `${topPct(item.startMin)}%`,
                          height: `${Math.max(5.5, heightPct(item.startMin, item.endMin))}%`,
                        }}
                        title={`${item.arriveLabel}–${item.leaveLabel} · ${item.stop.appel.magasin}${item.stop.reason ? ` · ${item.stop.reason}` : ""}`}
                      >
                        <button
                          type="button"
                          className="gt-cal-remove"
                          title="Retirer de l'horaire"
                          aria-label={`Retirer ${item.stop.appel.magasin}`}
                          disabled={removingId === item.stop.appel.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemoveStop?.(route.tech.id, item.stop.appel.id);
                          }}
                        >
                          ×
                        </button>
                        <span className="gt-cal-event-time">
                          {item.arriveLabel}–{item.leaveLabel}
                          {item.stop.pinned ? " · planifié" : ""}
                        </span>
                        <span className="gt-cal-event-title">
                          {item.index + 1}. {item.stop.appel.magasin}
                        </span>
                        <span className="gt-cal-event-meta">
                          {item.stop.reason ||
                            `${item.stop.appel.type === "preventif" ? "Préventif" : "Réactif"} · ${item.stop.minutesOnSite} min sur place`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
