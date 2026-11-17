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
  /** Date du rendez-vous déjà posé dans NetSuite (tâche), si elle existe. */
  scheduledOn?: string;
  /** Aperçu NetSuite (tâche et cas), absent en mode démo. */
  numeroCas?: string;
  site?: string;
  statutCas?: string;
  priorite?: string;
  /** Équipement de l'appel de service (champ Équipements du cas). */
  equipementDetail?: string;
  /** Détail de l'appel (champ Détails du cas). */
  details?: string;
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
  /** Pourquoi l'optimiseur a choisi cet arrêt. */
  reason?: string;
  driveMin?: number;
  driveKm?: number;
  arriveMin?: number;
  leaveMin?: number;
};

export type TechRoute = {
  tech: Tech;
  stops: DayStop[];
  google: import("@/lib/types").OptimizeRouteResponse | null;
  error: string | null;
  planDate?: string;
  totalDriveMin?: number;
  totalDriveKm?: number;
  returnDriveMin?: number;
  returnDriveKm?: number;
  finishMin?: number;
  travelSource?: "haversine" | "google" | "mixed";
};

export type RemoteTripCall = {
  appel: Appel;
  minutesOnSite: number;
  reason: string;
};

/** Appels trop loin pour un aller-retour 8 h–17 h, groupés par secteur. */
export type RemoteTrip = {
  id: string;
  area: string;
  kind: "nuitée" | "trajet dédié";
  reason: string;
  calls: RemoteTripCall[];
  localDriveMin: number;
  localDriveKm: number;
  depotOneWayMin: number;
  depotOneWayKm: number;
  onSiteDays: number;
};

export type PlanStats = {
  driveMin: number;
  driveKm: number;
  served: number;
  reactivesServed: number;
  reactives: number;
  slaMisses: number;
  remoteCalls: number;
  elapsedMs: number;
  travelMs: number;
  travelSource: "haversine" | "google" | "mixed";
  /** Présent quand Google a refusé (facturation, quota) et que le repli est utilisé. */
  travelWarning?: string;
  /** Techniciens présents mais retirés de la route (atelier, compte en double). */
  excludedTechs?: Array<{ id: string; name: string; reason: string }>;
  overtimeRoutes: number;
};
