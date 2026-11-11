import {
  ALL_SKILL_IDS,
  DEFAULT_DURATIONS,
  DRUMMONDVILLE_HQ,
  isReactifOverdue,
  preventifPerBusinessDay,
} from "./constants";
import { ROAD_WINDOW } from "./optimize";
import type { Appel, Tech } from "./types";

export function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Demo fallback only if clock unavailable — prefer todayIsoDate(). */
export const DEMO_PLAN_DATE = todayIsoDate();

export type PlannerInputs = {
  date: string;
  pmQuota: string;
  reactifDuration: string;
  preventifDuration: string;
  /** null = not chosen yet (empty). */
  moveAssigned: boolean | null;
  allowOvertime: boolean | null;
};

export type PlannerSuggestion = {
  date: string;
  pmQuota: string;
  reactifDuration: string;
  preventifDuration: string;
  moveAssigned: boolean;
  allowOvertime: boolean;
  techs: Tech[];
  calls: Appel[];
  summary: string[];
};

function isBlank(value: string | null | undefined): boolean {
  return value == null || String(value).trim() === "";
}

/** Roster with 4 techs présents by default (William, Marc, Sophie, Alex). */
export function createBlankRoster(): Tech[] {
  const roster = [
    blankTech("5", "William Villeneuve", "Centre-du-Québec", true),
    blankTech("12", "Marc Tremblay", "Mauricie", true),
    blankTech("18", "Sophie Gagnon", "Estrie", true),
    blankTech("21", "Alex Nguyen", "Montérégie", true),
    blankTech("27", "Karine Bouchard", "Chaudière-Appalaches", false),
    blankTech("33", "Jean-Philippe Roy", "Centre-du-Québec", false),
    blankTech("41", "Nadia Fortin", "Mauricie", false),
  ];
  return roster;
}

function blankTech(
  id: string,
  name: string,
  region: string,
  present = false,
): Tech {
  return {
    id,
    name,
    present,
    start: DRUMMONDVILLE_HQ,
    end: DRUMMONDVILLE_HQ,
    startHour: "",
    endHour: "",
    hours: 0,
    region,
    // Full skill set so « Générer les routes » works without opening Techniciens first.
    skills: [...ALL_SKILL_IDS],
  };
}

/** Strip assignment fields so the demo form starts empty (CSV = NetSuite call DB). */
export function blankCallAssignments(calls: Appel[]): Appel[] {
  return calls.map((appel) => ({
    ...appel,
    planifie: false,
    heure: "",
    techId: "",
  }));
}

/**
 * Fill only empty planner fields. Non-empty user values are kept and used as constraints
 * (which techs are already present, fixed hours, existing planifiés, etc.).
 */
export function suggestPlannerFields(options: {
  inputs: PlannerInputs;
  techs: Tech[];
  calls: Appel[];
  /** Tech ids whose Présent checkbox the user already toggled. */
  presenceTouched: Set<string>;
  /** Tech ids whose skill chips the user already edited. */
  skillsTouched: Set<string>;
}): PlannerSuggestion {
  const summary: string[] = [];
  const date = isBlank(options.inputs.date)
    ? todayIsoDate()
    : options.inputs.date;
  if (isBlank(options.inputs.date)) {
    summary.push(`Date → ${date}`);
  }

  const ratio = preventifPerBusinessDay(date);
  const regionCount = new Set(
    options.calls
      .filter((c) => c.type === "reactif" && c.region.trim())
      .map((c) => c.region),
  ).size;
  const quotaWasBlank = isBlank(options.inputs.pmQuota);
  let pmQuota = options.inputs.pmQuota;

  const reactifDuration = isBlank(options.inputs.reactifDuration)
    ? String(DEFAULT_DURATIONS.reactif)
    : options.inputs.reactifDuration;
  const preventifDuration = isBlank(options.inputs.preventifDuration)
    ? String(DEFAULT_DURATIONS.preventif)
    : options.inputs.preventifDuration;
  if (isBlank(options.inputs.reactifDuration)) {
    summary.push(`Durée réactif → ${reactifDuration} min`);
  }
  if (isBlank(options.inputs.preventifDuration)) {
    summary.push(`Durée préventif → ${preventifDuration} min`);
  }

  const moveAssigned =
    options.inputs.moveAssigned === null ? false : options.inputs.moveAssigned;
  if (options.inputs.moveAssigned === null) {
    summary.push("Déplacer tâches déjà attribuées → Non");
  }

  const allowOvertime =
    options.inputs.allowOvertime === null
      ? false
      : options.inputs.allowOvertime;
  if (options.inputs.allowOvertime === null) {
    summary.push(`Après ${ROAD_WINDOW.softEndLabel} → Non (avertir)`);
  }

  // Regions that need coverage for SLA (overdue + pending réactifs)
  const reactifs = options.calls.filter((c) => c.type === "reactif");
  const overdue = reactifs.filter((c) => isReactifOverdue(c, date));
  const pending = reactifs.filter((c) => !isReactifOverdue(c, date));
  const neededRegions = new Set<string>();
  for (const appel of [...overdue, ...pending]) {
    if (appel.region.trim()) neededRegions.add(appel.region);
  }
  // Always cover HQ region for demo density
  neededRegions.add("Centre-du-Québec");

  const alreadyPresent = options.techs.filter((t) => t.present).map((t) => t.id);
  const techs = options.techs.map((tech) => {
    const next = { ...tech };

    if (!options.presenceTouched.has(tech.id)) {
      const shouldBePresent = neededRegions.has(tech.region);
      // Prefer one tech per needed region; if region already has a present tech, skip extras
      const regionAlreadyCovered = options.techs.some(
        (other) =>
          other.id !== tech.id &&
          other.region === tech.region &&
          (other.present ||
            (alreadyPresent.includes(other.id) &&
              options.presenceTouched.has(other.id))),
      );
      // Pick first roster tech in region order for coverage
      const firstInRegion = options.techs.find((t) => t.region === tech.region);
      const pick =
        shouldBePresent &&
        firstInRegion?.id === tech.id &&
        !regionAlreadyCovered;
      if (pick && !next.present) {
        next.present = true;
      }
    }

    if (isBlank(next.startHour)) next.startHour = ROAD_WINDOW.start;
    if (isBlank(next.endHour)) next.endHour = ROAD_WINDOW.softEnd;
    if (isBlank(next.start)) next.start = DRUMMONDVILLE_HQ;
    if (isBlank(next.end)) next.end = DRUMMONDVILLE_HQ;

    if (
      !options.skillsTouched.has(tech.id) &&
      (!next.skills || next.skills.length === 0)
    ) {
      // Import ALL_SKILL_IDS lazily via full equipment list from existing default pattern
      next.skills = [...ALL_SKILL_IDS];
    }

    if (next.startHour && next.endHour) {
      const [sh, sm] = next.startHour.split(":").map(Number);
      const [eh, em] = next.endHour.split(":").map(Number);
      next.hours = Math.max(0, (eh * 60 + em - (sh * 60 + sm)) / 60);
    }

    return next;
  });

  // Second pass: ensure each needed region has at least one present tech
  for (const region of neededRegions) {
    const covered = techs.some((t) => t.present && t.region === region);
    if (covered) continue;
    const candidate = techs.find(
      (t) => t.region === region && !options.presenceTouched.has(t.id),
    );
    if (candidate) {
      candidate.present = true;
    }
  }

  let staffedWithoutZone = false;
  const anyZone = techs.some((tech) => tech.region.trim());
  if (!anyZone && !techs.some((tech) => tech.present)) {
    for (const tech of techs) {
      if (options.presenceTouched.has(tech.id)) continue;
      tech.present = true;
      staffedWithoutZone = true;
    }
  }

  if (quotaWasBlank) {
    const presentCount = Math.max(
      1,
      techs.filter((tech) => tech.present).length,
    );
    const packTarget = Math.max(
      Math.ceil(ratio),
      Math.max(4, regionCount) * 3,
      presentCount * 3,
    );
    pmQuota = String(Math.min(80, packTarget));
    summary.push(
      `Quota préventif → ${pmQuota} (${presentCount} technicien(s), ratio Q4 ≈ ${ratio}/jour)`,
    );
  }

  const newlyPresent = techs.filter((t) => t.present).map((t) => t.name);
  if (staffedWithoutZone) {
    summary.push(
      "Aucune zone technicien : tous les techniciens sont marqués présents (répartition par temps de route)",
    );
  }
  if (newlyPresent.length) {
    summary.push(`Techs présents → ${newlyPresent.join(", ")}`);
  }
  summary.push(
    `SLA réactif 2 j : ${overdue.length} délai dépassé, ${pending.length} en attente (pris en compte)`,
  );

  // Fill missing heure on already-planifié only (never clear user planifiés)
  const calls = options.calls.map((appel) => {
    if (appel.planifie && isBlank(appel.heure)) {
      return { ...appel, heure: "10:00" };
    }
    if (appel.planifie && isBlank(appel.techId)) {
      const tech =
        techs.find((t) => t.present && t.region === appel.region) ??
        techs.find((t) => t.present);
      return { ...appel, techId: tech?.id ?? "" };
    }
    return appel;
  });

  const filledPlanHours = calls.filter(
    (c, i) =>
      c.planifie &&
      c.heure &&
      (isBlank(options.calls[i]?.heure) || isBlank(options.calls[i]?.techId)),
  ).length;
  if (filledPlanHours > 0) {
    summary.push(
      `${filledPlanHours} planifié(s) complété(s) (heure/tech manquants)`,
    );
  }

  return {
    date,
    pmQuota,
    reactifDuration,
    preventifDuration,
    moveAssigned,
    allowOvertime,
    techs,
    calls,
    summary,
  };
}

export function parseDurations(reactif: string, preventif: string) {
  return {
    reactif: Number(reactif) || DEFAULT_DURATIONS.reactif,
    preventif: Number(preventif) || DEFAULT_DURATIONS.preventif,
  };
}
