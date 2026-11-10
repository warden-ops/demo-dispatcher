"use client";

import { useState } from "react";
import { RouteMap } from "@/components/RouteMap";
import { ScheduleCalendar } from "@/components/guertech/ScheduleCalendar";
import { DRUMMONDVILLE_CENTER } from "@/lib/guertech/constants";
import { ROAD_WINDOW } from "@/lib/guertech/optimize";
import type { OvertimeWarning } from "@/lib/guertech/optimize";
import type { PreventifSuggestion } from "@/lib/guertech/suggestions";
import type { TechRoute } from "@/lib/guertech/types";
import {
  buildGoogleMapsRouteUrl,
  buildRouteShareText,
} from "@/lib/maps-link";

type RouteBoardProps = {
  routes: TechRoute[];
  suggestions?: PreventifSuggestion[];
  onAcceptSuggestion?: (suggestion: PreventifSuggestion) => void;
  onRefuseSuggestion?: (suggestion: PreventifSuggestion) => void;
  onAcceptAllSuggestions?: () => void;
  onRefuseAllSuggestions?: () => void;
  acceptingId?: string | null;
  overtimeWarnings?: OvertimeWarning[];
  overtimeIgnored?: boolean;
  onIgnoreOvertime?: () => void;
  onTrimOvertime?: () => void;
  onRemoveStop?: (techId: string, appelId: string) => void;
  removingId?: string | null;
  onOpenTechPanel?: () => void;
  emptyHint?: string;
};

export function RouteBoard({
  routes,
  suggestions = [],
  onAcceptSuggestion,
  onRefuseSuggestion,
  onAcceptAllSuggestions,
  onRefuseAllSuggestions,
  acceptingId = null,
  overtimeWarnings = [],
  overtimeIgnored = false,
  onIgnoreOvertime,
  onTrimOvertime,
  onRemoveStop,
  removingId = null,
  onOpenTechPanel,
  emptyHint,
}: RouteBoardProps) {
  const withWork = routes.filter((route) => route.stops.length > 0);
  const [techId, setTechId] = useState(routes[0]?.tech.id ?? "");
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const current =
    routes.find((route) => route.tech.id === techId) ??
    withWork[0] ??
    routes[0] ??
    null;

  const [copyState, setCopyState] = useState("Copier le lien");

  const mapsUrl = current?.google
    ? buildGoogleMapsRouteUrl(current.google)
    : "";
  const shareText = current?.google
    ? buildRouteShareText(current.google, current.tech.name)
    : "";

  if (!current) {
    return (
      <section className="gt-panel">
        <div className="gt-results-head">
          <h2>Tournées</h2>
          {onOpenTechPanel ? (
            <button
              type="button"
              className="gt-btn-ghost gt-tech-panel-btn"
              onClick={onOpenTechPanel}
            >
              Techniciens
            </button>
          ) : null}
        </div>
        <p>
          Aucun technicien présent. Ouvrez le panneau Techniciens pour en
          activer.
        </p>
      </section>
    );
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(mapsUrl);
      setCopyState("Lien copié");
      window.setTimeout(() => setCopyState("Copier le lien"), 2000);
    } catch {
      setCopyState("Copie impossible");
    }
  }

  async function sendToTech() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Tournée ${current.tech.name}`,
          text: shareText,
          url: mapsUrl,
        });
        return;
      } catch {
        /* fall through */
      }
    }
    await copyLink();
  }

  return (
    <section className="gt-panel">
      <div className="gt-results-head">
        <h2>Tournées</h2>
        <div className="gt-results-actions">
          <div className="gt-tabs">
            <button
              type="button"
              className={view === "calendar" ? "on" : ""}
              onClick={() => setView("calendar")}
            >
              Calendrier
            </button>
            <button
              type="button"
              className={view === "list" ? "on" : ""}
              onClick={() => setView("list")}
            >
              Liste + carte
            </button>
          </div>
          {onOpenTechPanel ? (
            <button
              type="button"
              className="gt-btn-ghost gt-tech-panel-btn"
              onClick={onOpenTechPanel}
            >
              Techniciens
            </button>
          ) : null}
        </div>
      </div>

      {overtimeWarnings.length > 0 && !overtimeIgnored ? (
        <div className="gt-overtime-banner" role="alert">
          <div>
            <strong>
              Avertissement — fenêtre 8 h–{ROAD_WINDOW.softEndLabel}
            </strong>
            <p>
              {overtimeWarnings.length} technicien(s) termineraient après{" "}
              {ROAD_WINDOW.softEndLabel} (retour dépôt inclus) :
              {" "}
              {overtimeWarnings
                .map(
                  (item) =>
                    `${item.techName} (~${item.finishLabel}, +${item.overtimeMin} min)`,
                )
                .join(" · ")}
              . Vous pouvez ignorer l&apos;avertissement ou raccourcir
              automatiquement.
            </p>
          </div>
          <div className="gt-overtime-actions">
            <button
              type="button"
              className="gt-btn-ghost"
              onClick={onIgnoreOvertime}
            >
              Ignorer
            </button>
            <button type="button" className="gt-btn" onClick={onTrimOvertime}>
              Raccourcir pour finir à {ROAD_WINDOW.softEndLabel}
            </button>
          </div>
        </div>
      ) : null}

      {overtimeWarnings.length > 0 && overtimeIgnored ? (
        <p className="gt-overtime-ignored">
          Fenêtre 8 h–{ROAD_WINDOW.softEndLabel} dépassée — avertissement ignoré
          ({overtimeWarnings.map((item) => item.techName).join(", ")}).
        </p>
      ) : null}

      {view === "calendar" ? (
        <>
          {emptyHint && withWork.length === 0 ? (
            <p className="gt-share-hint">{emptyHint}</p>
          ) : (
            <p className="gt-share-hint">
              Horaires côte à côte. Les bandes hachurées sont les trajets Google
              Maps. Suggestions en pointillés : cliquez{" "}
              <strong>Accepter</strong> pour les ajouter.
            </p>
          )}
          <ScheduleCalendar
            routes={routes}
            suggestions={suggestions}
            selectedTechId={current.tech.id}
            onSelectTech={setTechId}
            onAcceptSuggestion={onAcceptSuggestion}
            onRefuseSuggestion={onRefuseSuggestion}
            onAcceptAllSuggestions={onAcceptAllSuggestions}
            onRefuseAllSuggestions={onRefuseAllSuggestions}
            acceptingId={acceptingId}
            onRemoveStop={onRemoveStop}
            removingId={removingId}
          />
          {withWork.length > 0 ? (
            <div className="gt-share" style={{ marginTop: "0.85rem" }}>
              <strong style={{ alignSelf: "center" }}>{current.tech.name}</strong>
              {current.google ? (
                <>
                  <a
                    className="gt-btn"
                    href={mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ouvrir dans Google Maps
                  </a>
                  <button
                    type="button"
                    className="gt-btn-ghost"
                    onClick={sendToTech}
                  >
                    Envoyer au technicien
                  </button>
                  <button
                    type="button"
                    className="gt-btn-ghost"
                    onClick={copyLink}
                  >
                    {copyState}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </>
      ) : withWork.length === 0 ? (
        <p className="gt-section-empty">
          Aucun arrêt encore — générez les routes pour remplir la liste.
        </p>
      ) : (
        <>
          <div className="gt-results-nav">
            {withWork.map((route) => (
              <button
                key={route.tech.id}
                type="button"
                className={
                  route.tech.id === current.tech.id ? "gt-btn" : "gt-btn-ghost"
                }
                onClick={() => setTechId(route.tech.id)}
              >
                {route.tech.name} ({route.stops.length})
              </button>
            ))}
          </div>

          {current.error ? <p className="gt-error">{current.error}</p> : null}

          {current.google ? (
            <div className="gt-share">
              <a
                className="gt-btn"
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Ouvrir dans Google Maps
              </a>
              <button
                type="button"
                className="gt-btn-ghost"
                onClick={sendToTech}
              >
                Envoyer au technicien
              </button>
              <button type="button" className="gt-btn-ghost" onClick={copyLink}>
                {copyState}
              </button>
            </div>
          ) : null}

          <ol className="optimized-list">
            {current.stops.map((stop, index) => (
              <li
                key={stop.appel.id}
                className={`optimized-item${stop.pinned ? " gt-stop-pin" : ""}`}
              >
                <span className="badge">{index + 1}</span>
                <div>
                  <p className="optimized-address">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.appel.adresse)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {stop.appel.magasin}
                    </a>
                    {stop.pinned ? " · planifié" : ""}
                  </p>
                  <p className="optimized-leg">
                    <span className={`gt-tag ${stop.appel.type}`}>
                      {stop.appel.type === "preventif"
                        ? "Préventif"
                        : "Réactif"}
                    </span>
                    {stop.appel.adresse}
                    {stop.pinned ? ` · ${stop.appel.heure}` : ""}
                    {current.google?.optimizedStopDetails[index]
                      ? ` · ${current.google.optimizedStopDetails[index].arriveLabel}–${current.google.optimizedStopDetails[index].leaveLabel}`
                      : ""}
                  </p>
                  {current.google?.legs[index] ? (
                    <p className="optimized-leg">
                      Trajet vers cet arrêt :{" "}
                      {current.google.legs[index].durationText} ·{" "}
                      {current.google.legs[index].distanceText}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          <RouteMap
            result={current.google}
            defaultCenter={DRUMMONDVILLE_CENTER}
          />
        </>
      )}
    </section>
  );
}
