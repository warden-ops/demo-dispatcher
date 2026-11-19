// Généré par scripts/netsuite-tech-bases.py (NetSuite prod, lecture seule).
// Point de départ ESTIMÉ : aucun domicile dans NetSuite. À confirmer par Guertech.
export type TechBase = {
  label: string;
  lat: number;
  lng: number;
  /** Journées utilisées pour l'estimation. */
  days: number;
  /** Part des journées qui commencent à 35 km ou moins. */
  share: number;
};

export const TECH_BASES: Record<string, TechBase> = {
  "280871": {
    label: "Saint-Nicolas",
    lat: 46.716,
    lng: -71.296,
    days: 53,
    share: 0.47,
  },
  "361184": {
    label: "Beloeil",
    lat: 45.596,
    lng: -73.199,
    days: 80,
    share: 0.31,
  },
  "259020": {
    label: "Boucherville",
    lat: 45.621,
    lng: -73.455,
    days: 70,
    share: 0.4,
  },
  "131": {
    label: "Saint-Hyacinthe",
    lat: 45.639,
    lng: -72.968,
    days: 32,
    share: 0.19,
  },
  "124": {
    label: "Longueuil",
    lat: 45.542,
    lng: -73.455,
    days: 53,
    share: 0.42,
  },
  "463934": {
    label: "Blainville",
    lat: 45.675,
    lng: -73.882,
    days: 25,
    share: 0.6,
  },
  "368391": {
    label: "Montréal",
    lat: 45.557,
    lng: -73.57,
    days: 26,
    share: 0.38,
  },
  "123": {
    label: "Montréal",
    lat: 45.519,
    lng: -73.564,
    days: 78,
    share: 0.73,
  },
};
