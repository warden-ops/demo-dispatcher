"use client";

import { isReactifOverdue, TIME_SLOTS } from "@/lib/guertech/constants";
import type { Appel, CallType, Tech } from "@/lib/guertech/types";

type CallListProps = {
  calls: Appel[];
  techs: Tech[];
  asOfDate: string;
  filter: "all" | CallType | "overdue";
  plannedOnly: boolean;
  search: string;
  onFilter: (filter: "all" | CallType | "overdue") => void;
  onPlannedOnly: (value: boolean) => void;
  onSearch: (value: string) => void;
  onUpdate: (id: string, patch: Partial<Appel>) => void;
  onCalendarIds?: Set<string>;
};

function CallCard({
  appel,
  techs,
  overdue,
  onUpdate,
  onCalendar,
}: {
  appel: Appel;
  techs: Tech[];
  overdue?: boolean;
  onUpdate: (id: string, patch: Partial<Appel>) => void;
  onCalendar?: boolean;
}) {
  return (
    <article className={`gt-call${overdue ? " gt-call-overdue" : ""}`}>
      <div>
        <h3>
          <span className={`gt-tag ${appel.type}`}>
            {appel.type === "preventif" ? "Préventif" : "Réactif"}
          </span>
          {overdue ? <span className="gt-tag overdue">Délai dépassé</span> : null}
          {appel.planifie ? (
            <span className="gt-tag pin">Planifié {appel.heure}</span>
          ) : null}
          {onCalendar ? <span className="gt-tag pin">Calendrier</span> : null}
          {appel.magasin}
        </h3>
        <p>
          {appel.adresse} · {appel.equipement} · {appel.netsuiteId}
          {appel.type === "reactif" ? ` · ouvert ${appel.openedAt}` : ""}
        </p>
      </div>
      <div className="gt-call-actions">
        <label className="gt-check">
          <input
            type="checkbox"
            checked={appel.planifie}
            onChange={(event) => {
              const planifie = event.target.checked;
              onUpdate(appel.id, {
                planifie,
                heure: planifie ? appel.heure || "10:00" : "",
                techId: planifie
                  ? appel.techId || techs.find((tech) => tech.present)?.id || ""
                  : appel.techId,
              });
            }}
          />
          Planifié
        </label>
        {appel.planifie ? (
          <>
            <label className="gt-field">
              <span>Heure (24 h) *</span>
              <select
                required
                value={appel.heure}
                onChange={(event) =>
                  onUpdate(appel.id, { heure: event.target.value })
                }
              >
                <option value="">Choisir</option>
                {appel.heure && !TIME_SLOTS.includes(appel.heure) ? (
                  <option value={appel.heure}>{appel.heure}</option>
                ) : null}
                {TIME_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </label>
            <label className="gt-field">
              <span>Technicien</span>
              <select
                value={appel.techId}
                onChange={(event) =>
                  onUpdate(appel.id, { techId: event.target.value })
                }
              >
                {appel.techId &&
                !techs.some((tech) => tech.id === appel.techId) ? (
                  <option value={appel.techId}>
                    Technicien {appel.techId}
                  </option>
                ) : null}
                {techs.map((tech) => (
                  <option key={tech.id} value={tech.id}>
                    {tech.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="gt-call-hint">
              {onCalendar
                ? "Déjà sur le calendrier — changez l’heure ou le tech pour mettre à jour."
                : "S’ajoute au calendrier dès que l’heure est choisie."}
            </p>
          </>
        ) : null}
      </div>
    </article>
  );
}

export function CallList({
  calls,
  techs,
  asOfDate,
  filter,
  plannedOnly,
  search,
  onFilter,
  onPlannedOnly,
  onSearch,
  onUpdate,
  onCalendarIds,
}: CallListProps) {
  const query = search.trim().toLowerCase();

  const filtered = calls.filter((appel) => {
    if (filter === "preventif" && appel.type !== "preventif") return false;
    if (filter === "reactif" && appel.type !== "reactif") return false;
    if (filter === "overdue" && !isReactifOverdue(appel, asOfDate)) return false;
    if (plannedOnly && !appel.planifie) return false;
    if (!query) return true;
    return (
      appel.magasin.toLowerCase().includes(query) ||
      appel.adresse.toLowerCase().includes(query) ||
      appel.netsuiteId.toLowerCase().includes(query)
    );
  });

  const overdue = filtered.filter((appel) =>
    isReactifOverdue(appel, asOfDate),
  );
  const reactifPending = filtered.filter(
    (appel) =>
      appel.type === "reactif" && !isReactifOverdue(appel, asOfDate),
  );
  const preventif = filtered.filter((appel) => appel.type === "preventif");

  const sections =
    filter === "all"
      ? [
          {
            title: "Réactif — délai dépassé",
            items: overdue,
            overdue: true,
          },
          {
            title: "Réactif — en attente (délai 2 jours)",
            items: reactifPending,
            overdue: false,
          },
          {
            title: "Préventif",
            items: preventif,
            overdue: false,
          },
        ]
      : [
          {
            title:
              filter === "overdue"
                ? "Réactif — délai dépassé"
                : filter === "reactif"
                  ? "Réactif"
                  : "Préventif",
            items: filtered,
            overdue: filter === "overdue",
          },
        ];

  return (
    <section className="gt-panel">
      <h2>
        Appels ({filtered.length} / {calls.length})
      </h2>
      <div className="gt-tabs">
        <button
          type="button"
          className={filter === "all" ? "on" : ""}
          onClick={() => onFilter("all")}
        >
          Tous
        </button>
        <button
          type="button"
          className={filter === "preventif" ? "on" : ""}
          onClick={() => onFilter("preventif")}
        >
          Préventif
        </button>
        <button
          type="button"
          className={filter === "reactif" ? "on" : ""}
          onClick={() => onFilter("reactif")}
        >
          Réactif
        </button>
        <button
          type="button"
          className={filter === "overdue" ? "on" : ""}
          onClick={() => onFilter("overdue")}
        >
          Délai dépassé ({overdue.length || calls.filter((c) => isReactifOverdue(c, asOfDate)).length})
        </button>
      </div>
      <div className="gt-row">
        <input
          className="gt-search"
          placeholder="Rechercher magasin, adresse, NS…"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        <label className="gt-check">
          <input
            type="checkbox"
            checked={plannedOnly}
            onChange={(event) => onPlannedOnly(event.target.checked)}
          />
          Planifié seulement
        </label>
      </div>
      <div className="gt-list">
        {sections.map((section) => {
          if (section.items.length === 0 && !section.overdue) return null;
          const shown = section.items;
          return (
            <div key={section.title} className="gt-call-section">
              <h3
                className={`gt-section-title${section.overdue ? " overdue" : ""}`}
              >
                {section.title} <span>({section.items.length})</span>
              </h3>
              {section.items.length === 0 ? (
                <p className="gt-section-empty">Aucun appel dans cette section.</p>
              ) : (
                shown.map((appel) => (
                  <CallCard
                    key={appel.id}
                    appel={appel}
                    techs={techs}
                    overdue={section.overdue}
                    onUpdate={onUpdate}
                    onCalendar={onCalendarIds?.has(appel.id)}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
