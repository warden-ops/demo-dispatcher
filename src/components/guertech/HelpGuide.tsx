"use client";

import { useEffect, useState } from "react";

const STEPS = [
  {
    title: "Techniciens",
    body: "Ouvrez le panneau pour cocher qui est présent, les horaires (8 h–17 h) et les compétences. Les champs déjà remplis ne seront pas écrasés.",
  },
  {
    title: "Générer une suggestion",
    body: "Remplit les champs vides et construit tout de suite les tournées dans le calendrier (urgence d’abord, trajets Google).",
  },
  {
    title: "Appels planifiés",
    body: "Cochez Planifié + heure + tech : l’arrêt apparaît immédiatement au calendrier. × le retire.",
  },
  {
    title: "Calendrier",
    body: "Rouge = réactif, jaune = préventif, hachuré = trajet. Accepter ou Refuser les suggestions (une par une ou toutes).",
  },
  {
    title: "Fenêtre 8 h–17 h",
    body: "Si une tournée dépasse 17 h : ignorer l’avertissement ou raccourcir automatiquement.",
  },
  {
    title: "NetSuite",
    body: "Envoyer à NetSuite écrit les arrêts du calendrier dans le sandbox si l'écriture est activée. En mode démo, aucun envoi.",
  },
] as const;

export function HelpGuide() {
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(0);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => {
      setActive((current) => (current + 1) % STEPS.length);
    }, 3200);
    return () => window.clearInterval(id);
  }, [open]);

  return (
    <section className="gt-help" aria-label="Instructions">
      <button
        type="button"
        className="gt-help-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="gt-help-pulse" aria-hidden />
        <span className="gt-help-toggle-label">
          Guide rapide — comment planifier la journée
        </span>
        <span className="gt-help-chevron" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <ol className={`gt-help-steps${entered ? " is-ready" : ""}`}>
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className={`gt-help-step${active === index ? " is-active" : ""}`}
              style={{ transitionDelay: `${index * 0.1}s` }}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
            >
              <span className="gt-help-dot" aria-hidden>
                {index + 1}
              </span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
