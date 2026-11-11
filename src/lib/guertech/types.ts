export type CallType = "preventif" | "reactif";

export type Appel = {
  id: string;
  type: CallType;
  magasin: string;
  adresse: string;
  ville: string;
  region: string;
  /** Rempli par NetSuite ou par le géocodage serveur. Absent en mode démo. */
  lat?: number;
  lng?: number;
  equipement: string;
  equipementId: number;
  netsuiteId: string;
  planifie: boolean;
  heure: string;
  techId: string;
  /** ISO date (YYYY-MM-DD) when the call was opened — used for réactif SLA. */
  openedAt: string;
};

export type Tech = {
  id: string;
  name: string;
  present: boolean;
  start: string;
  end: string;
  startHour: string;
  endHour: string;
  hours: number;
  region: string;
  skills: number[];
};

export type Unassigned = {
  appel: Appel;
  reason: string;
};

export type DayStop = {
  appel: Appel;
  minutesOnSite: number;
  pinned: boolean;
};

export type TechRoute = {
  tech: Tech;
  stops: DayStop[];
  google: import("@/lib/types").OptimizeRouteResponse | null;
  error: string | null;
};
