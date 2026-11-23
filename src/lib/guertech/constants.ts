import type { Tech } from "./types";

export const GUERTECH_NAVY = "#193e7b";
export const DRUMMONDVILLE_HQ =
  "100-1000 rue Cormier, Drummondville, QC J2C 2N6";
export const DRUMMONDVILLE_CENTER = { lat: 45.883, lng: -72.484 };

export const REGIONS = [
  "Centre-du-Québec",
  "Mauricie",
  "Estrie",
  "Chaudière-Appalaches",
  "Montérégie",
] as const;

export const EQUIPMENT = [
  { name: "Accessoire TP", id: 30 },
  { name: "ADMIN", id: 37 },
  { name: "Boissons en fontaine", id: 27 },
  { name: "BW3 Désinstallé", id: 38 },
  { name: "Café filtre", id: 5 },
  { name: "Cappuccino Glacé", id: 16 },
  { name: "Chocolatière", id: 7 },
  { name: "CT CUR-GEM3IF", id: 32 },
  { name: "Distributeur à eau chaude", id: 22 },
  { name: "Distributeur à sucre", id: 20 },
  { name: "Distributeur lait/crème", id: 8 },
  { name: "Distributrice", id: 25 },
  { name: "Espresso", id: 2 },
  { name: "Filtration d'eau", id: 6 },
  { name: "Four à Convection", id: 14 },
  { name: "Four Combi", id: 9 },
  { name: "Four Micro-onde", id: 13 },
  { name: "Frigo à Condiments", id: 18 },
  { name: "Grille-Pain", id: 11 },
  { name: "Hotte", id: 10 },
  { name: "K-Cup", id: 24 },
  { name: "KIT ENTRETIEN", id: 34 },
  { name: "Krystaline", id: 29 },
  { name: "Lassonde", id: 39 },
  { name: "Lave-vaisselle", id: 26 },
  { name: "Machine à Glace", id: 15 },
  { name: "Moulin", id: 17 },
  { name: "Panini", id: 23 },
  { name: "PIÈCES RP", id: 35 },
  { name: "Polar-pop", id: 33 },
  { name: "PopCorn", id: 12 },
  { name: "Réchaud", id: 3 },
  { name: "Réfrigérateur", id: 28 },
  { name: "Refroidisseur", id: 31 },
  { name: "Roller Grill", id: 4 },
  { name: "Site", id: 1 },
  { name: "Slush", id: 42 },
  { name: "Table chaude", id: 40 },
  { name: "Thé", id: 21 },
  { name: "Thermos", id: 19 },
] as const;

export const ALL_SKILL_IDS = EQUIPMENT.map((item) => item.id);

export const TIME_SLOTS = Array.from({ length: 23 }, (_, index) => {
  const minutes = 7 * 60 + index * 30;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});

/**
 * Durées sur place par défaut : médianes des blocs planifiés dans NetSuite
 * (tâches « Sur place » terminées, 12 mois : 8 492 réactifs, 1 040 préventifs).
 * Voir tech-profiles.data.ts. Le répartiteur peut toujours les changer.
 */
export const DEFAULT_DURATIONS = {
  reactif: 120,
  preventif: 60,
};

export const SLA = {
  reactif: { delayDays: 2, priority: 1, netsuiteId: "NS-TYPE-REPAIR" },
  preventif: { delayDays: 90, priority: 4, netsuiteId: "NS-TYPE-PM" },
};

/** Real-situation Q4 context for the demo (deadline = fin du 4e quart). */
export const QUARTER = {
  yearTarget: 800,
  /** 800 / 4 — entretiens préventifs restants à planifier d'ici la fin du Q4. */
  quarterTarget: 200,
  deadline: "2026-12-31",
  deadlineLabel: "31 décembre 2026",
  lastQuarterBacklog: 38,
};

/** Count Mon–Fri days from `fromIso` (inclusive) through `toIso` (inclusive). */
export function countBusinessDays(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T12:00:00`);
  const to = new Date(`${toIso}T12:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return 0;
  }
  let count = 0;
  const cursor = new Date(from);
  while (cursor <= to) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/** Average préventifs to schedule per business day until the Q4 deadline. */
export function preventifPerBusinessDay(fromIso: string): number {
  const days = countBusinessDays(fromIso, QUARTER.deadline);
  if (days <= 0) return QUARTER.quarterTarget;
  return Math.ceil((QUARTER.quarterTarget / days) * 10) / 10;
}

/**
 * Plafond de préventifs par technicien de route et par journée, pour le quota par défaut.
 * L'historique NetSuite (août-novembre 2026) donne 4 à 5 visites par jour ; à 5, le quota
 * bloquait le planificateur certains jours. À 8, ce sont la route et la fin de journée qui
 * limitent chaque tournée, pas le quota.
 */
export const PM_PER_TECH_DAY = 8;

/**
 * Quota préventif par défaut quand le champ est vide : assez de place pour remplir les journées
 * (techniciens de route présents × PM_PER_TECH_DAY), jamais sous le rythme Q4. Le temps de route et
 * la fin de journée bornent ensuite chaque route. L'ancien défaut (rythme Q4 seul, environ 7 par jour
 * pour toute l'équipe) limitait les techniciens à environ 3 appels par jour.
 */
export function defaultPmQuota(roadTechsPresent: number, q4Ratio: number): number {
  const target = Math.max(Math.ceil(q4Ratio), Math.max(1, roadTechsPresent) * PM_PER_TECH_DAY);
  return Math.min(80, target);
}

/** Calendar days open (openedAt → asOf), for réactif 2-day SLA. */
export function daysOpen(openedAt: string, asOfIso: string): number {
  const opened = new Date(`${openedAt}T12:00:00`);
  const asOf = new Date(`${asOfIso}T12:00:00`);
  if (Number.isNaN(opened.getTime()) || Number.isNaN(asOf.getTime())) return 0;
  const diff = Math.floor((asOf.getTime() - opened.getTime()) / 86_400_000);
  return Math.max(0, diff);
}

export function isReactifOverdue(
  appel: { type: string; openedAt: string },
  asOfIso: string,
  slaDays = SLA.reactif.delayDays,
): boolean {
  return appel.type === "reactif" && daysOpen(appel.openedAt, asOfIso) > slaDays;
}

function tech(
  id: string,
  name: string,
  region: string,
  present: boolean,
  skillSkip: number[] = [],
): Tech {
  return {
    id,
    name,
    present,
    start: DRUMMONDVILLE_HQ,
    end: DRUMMONDVILLE_HQ,
    startHour: "08:00",
    endHour: "17:00",
    hours: 9,
    region,
    skills: ALL_SKILL_IDS.filter((skillId) => !skillSkip.includes(skillId)),
  };
}

export function createDefaultTechs(): Tech[] {
  return [
    tech("5", "William Villeneuve", "Centre-du-Québec", true),
    tech("12", "Marc Tremblay", "Mauricie", true, [38, 43]),
    tech("18", "Sophie Gagnon", "Estrie", true, [35, 41]),
    tech("21", "Alex Nguyen", "Montérégie", true, [32, 39]),
    tech("27", "Karine Bouchard", "Chaudière-Appalaches", false),
    tech("33", "Jean-Philippe Roy", "Centre-du-Québec", false),
    tech("41", "Nadia Fortin", "Mauricie", false),
  ];
}
