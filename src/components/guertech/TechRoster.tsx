"use client";

import { useState } from "react";
import { AddressInput } from "@/components/AddressInput";
import { EQUIPMENT, REGIONS } from "@/lib/guertech/constants";
import type { Tech } from "@/lib/guertech/types";

type TechRosterProps = {
  techs: Tech[];
  onChange: (id: string, patch: Partial<Tech>) => void;
  onAdd: () => void;
  defaultOpen?: boolean;
  hideToggle?: boolean;
};

export function TechRoster({
  techs,
  onChange,
  onAdd,
  defaultOpen = true,
  hideToggle = false,
}: TechRosterProps) {
  const [open, setOpen] = useState(defaultOpen);
  const presentCount = techs.filter((tech) => tech.present).length;
  const showBody = hideToggle || open;

  return (
    <section
      className={
        hideToggle
          ? "gt-roster-plain"
          : `gt-panel gt-roster${showBody ? "" : " collapsed"}`
      }
    >
      {hideToggle ? null : (
        <button
          type="button"
          className="gt-panel-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <h2>Techniciens</h2>
          <span className="gt-panel-toggle-meta">
            {presentCount} présent{presentCount > 1 ? "s" : ""} / {techs.length}
          </span>
          <span className="gt-panel-chevron" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
        </button>
      )}

      {showBody ? (
        <>
          {techs.map((tech, index) => (
            <article
              key={tech.id}
              className="gt-tech"
              style={{ animationDelay: `${index * 0.12}s` }}
            >
              <div className="gt-tech-head">
                <label className="gt-check">
                  <input
                    type="checkbox"
                    checked={tech.present}
                    onChange={(event) =>
                      onChange(tech.id, { present: event.target.checked })
                    }
                  />
                  Présent
                </label>
                <strong>
                  {tech.name} · NS {tech.id}
                </strong>
              </div>
              <div className="gt-row">
                <label className="gt-field">
                  <span>Nom</span>
                  <input
                    value={tech.name}
                    onChange={(event) =>
                      onChange(tech.id, { name: event.target.value })
                    }
                  />
                </label>
                <label className="gt-field">
                  <span>Zone</span>
                  <select
                    value={tech.region}
                    onChange={(event) =>
                      onChange(tech.id, { region: event.target.value })
                    }
                  >
                    <option value="">Non précisée</option>
                    {tech.region &&
                    !(REGIONS as readonly string[]).includes(tech.region) ? (
                      <option value={tech.region}>{tech.region}</option>
                    ) : null}
                    {REGIONS.map((region) => (
                      <option key={region}>{region}</option>
                    ))}
                  </select>
                </label>
                <label className="gt-field">
                  <span>Départ</span>
                  <input
                    type="time"
                    value={tech.startHour}
                    placeholder="08:00"
                    onChange={(event) =>
                      onChange(tech.id, { startHour: event.target.value })
                    }
                  />
                </label>
                <label className="gt-field">
                  <span>Fin</span>
                  <input
                    type="time"
                    value={tech.endHour}
                    placeholder="17:00"
                    onChange={(event) =>
                      onChange(tech.id, { endHour: event.target.value })
                    }
                  />
                </label>
              </div>
              <AddressInput
                id={`start-${tech.id}`}
                label="Point de départ"
                value={tech.start}
                placeholder="Adresse de départ"
                onChange={(value) => onChange(tech.id, { start: value })}
              />
              <AddressInput
                id={`end-${tech.id}`}
                label="Point d'arrivée"
                value={tech.end}
                placeholder="Adresse d'arrivée"
                onChange={(value) => onChange(tech.id, { end: value })}
              />
              <div className="gt-skills">
                {EQUIPMENT.map((item) => {
                  const on = tech.skills.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`gt-chip${on ? " on" : ""}`}
                      onClick={() =>
                        onChange(tech.id, {
                          skills: on
                            ? tech.skills.filter((id) => id !== item.id)
                            : [...tech.skills, item.id],
                        })
                      }
                    >
                      {item.name}
                    </button>
                  );
                })}
              </div>
            </article>
          ))}
          <button type="button" className="gt-btn-ghost" onClick={onAdd}>
            Ajouter un technicien (+)
          </button>
        </>
      ) : null}
    </section>
  );
}
