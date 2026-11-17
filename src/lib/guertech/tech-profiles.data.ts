// Généré à partir de NetSuite prod (lecture seule) le 2026-11-17 : tâches « Sur place »
// COMPLETE liées à un cas, 6 derniers mois pour les zones, 12 mois pour les durées.
// Aucune donnée personnelle : identifiant NetSuite, rôle et secteurs (centroïdes de villes).
// Régénérer : scripts/netsuite-tech-profiles.py (voir docs/profils-techniciens.md).

export type TechZoneAnchor = {
  label: string;
  lat: number;
  lng: number;
  radiusKm: number;
  share: number;
};

export type TechRole = "route" | "atelier" | "doublon";

export type TechProfile = {
  role: TechRole;
  /** Visites sur place des 6 derniers mois ayant servi à calculer les secteurs. */
  visits6m: number;
  anchors: TechZoneAnchor[];
};

export const TECH_PROFILES: Record<string, TechProfile> = {
  "355464": {
    role: "atelier",
    visits6m: 18,
    anchors: [
      { label: "Drummondville", lat: 45.887, lng: -72.511, radiusKm: 15, share: 0.94 },
    ],
  },
  "280871": {
    role: "route",
    visits6m: 324,
    anchors: [
      { label: "Québec", lat: 46.796, lng: -71.277, radiusKm: 16, share: 0.49 },
      { label: "Montréal", lat: 45.5, lng: -73.638, radiusKm: 25, share: 0.23 },
      { label: "Victoriaville", lat: 46.107, lng: -71.901, radiusKm: 15, share: 0.1 },
    ],
  },
  "464035": {
    role: "atelier",
    visits6m: 1,
    anchors: [],
  },
  "361184": {
    role: "route",
    visits6m: 467,
    anchors: [
      { label: "Montréal", lat: 45.536, lng: -73.559, radiusKm: 27, share: 0.52 },
      { label: "Québec", lat: 46.806, lng: -71.317, radiusKm: 15, share: 0.22 },
      { label: "Drummondville", lat: 45.784, lng: -72.671, radiusKm: 43, share: 0.08 },
    ],
  },
  "259020": {
    role: "route",
    visits6m: 514,
    anchors: [
      { label: "Montréal", lat: 45.539, lng: -73.504, radiusKm: 27, share: 0.6 },
      { label: "Québec", lat: 46.806, lng: -71.324, radiusKm: 15, share: 0.15 },
      { label: "Sherbrooke", lat: 45.366, lng: -71.97, radiusKm: 23, share: 0.11 },
    ],
  },
  "454017": {
    role: "atelier",
    visits6m: 0,
    anchors: [],
  },
  "131": {
    role: "route",
    visits6m: 256,
    anchors: [
      { label: "Montréal", lat: 45.551, lng: -73.433, radiusKm: 37, share: 0.62 },
      { label: "Sherbrooke", lat: 45.344, lng: -72.256, radiusKm: 37, share: 0.13 },
    ],
  },
  "472844": {
    role: "atelier",
    visits6m: 0,
    anchors: [],
  },
  "124": {
    role: "route",
    visits6m: 222,
    anchors: [
      { label: "Montréal", lat: 45.522, lng: -73.392, radiusKm: 34, share: 0.36 },
      { label: "Montréal", lat: 45.501, lng: -73.815, radiusKm: 22, share: 0.14 },
      { label: "Trois-Rivières", lat: 46.382, lng: -72.539, radiusKm: 40, share: 0.14 },
      { label: "Sherbrooke", lat: 45.319, lng: -71.9, radiusKm: 22, share: 0.1 },
      { label: "Québec", lat: 46.8, lng: -71.307, radiusKm: 26, share: 0.09 },
    ],
  },
  "113": {
    role: "route",
    visits6m: 27,
    anchors: [
      { label: "Sherbrooke", lat: 45.446, lng: -71.948, radiusKm: 37, share: 0.44 },
    ],
  },
  "463934": {
    role: "route",
    visits6m: 93,
    anchors: [
      { label: "Laval", lat: 45.699, lng: -73.737, radiusKm: 29, share: 0.76 },
      { label: "Gatineau", lat: 45.527, lng: -75.531, radiusKm: 15, share: 0.16 },
    ],
  },
  "368391": {
    role: "route",
    visits6m: 63,
    anchors: [
      { label: "Montréal", lat: 45.548, lng: -73.597, radiusKm: 20, share: 0.4 },
      { label: "Drummondville", lat: 45.765, lng: -72.587, radiusKm: 31, share: 0.13 },
    ],
  },
  "11": {
    role: "doublon",
    visits6m: 0,
    anchors: [],
  },
  "123": {
    role: "route",
    visits6m: 425,
    anchors: [
      { label: "Montréal", lat: 45.509, lng: -73.659, radiusKm: 20, share: 0.71 },
      { label: "Granby", lat: 45.395, lng: -72.756, radiusKm: 41, share: 0.23 },
    ],
  },
};

/** Médianes des blocs planifiés (début → fin de tâche), NetSuite prod, 12 mois. */
export const NETSUITE_DURATION_MEDIANS = {
  preventif: { minutes: 60, n: 1040, p25: 45, p75: 120 },
  reactif: { minutes: 120, n: 8492, p25: 75, p75: 120 },
} as const;
