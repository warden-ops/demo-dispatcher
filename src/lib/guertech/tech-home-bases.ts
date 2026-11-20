// Domiciles fixes confirmés par Guertech (Isaac Dupont, 19 nov. 2026).
// Tous les autres techniciens partent du dépôt et y reviennent.
//
// Coordonnées : Geocoder.ca (https://geocoder.ca, précision à l'adresse,
// confidence 1), contre-vérifiées avec OpenStreetMap Nominatim
// (https://nominatim.openstreetmap.org) le 19 nov. 2026. Codées en dur parce
// que la clé Google Maps du serveur est vide.

export type HomeBase = {
  /** Libellé court affiché dans le plan. */
  label: string;
  /** Adresse complète, préremplie dans la liste des techniciens. */
  address: string;
  lat: number;
  lng: number;
  /** Le technicien revient à la même adresse en fin de journée. */
  returnsHome: boolean;
  source: string;
};

export const TECH_HOME_BASES: Record<string, HomeBase> = {
  // Philippe Marier
  "463934": {
    label: "Labelle",
    address: "122 rue de la Falaise, Labelle, QC J0T 1H0",
    lat: 46.273778,
    lng: -74.725315,
    returnsHome: true,
    source: "Geocoder.ca (Nominatim : rue de la Falaise, 46.2753, -74.7264)",
  },
  // William Villeneuve
  "123": {
    label: "Granby",
    address: "212 rue Cartier, Granby, QC J2G 5A6",
    lat: 45.40719,
    lng: -72.723142,
    returnsHome: true,
    source: "Geocoder.ca (Nominatim : 212 rue Cartier, 45.4070, -72.7230)",
  },
};
