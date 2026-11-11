import { ALL_SKILL_IDS, DRUMMONDVILLE_HQ } from "./constants";
import type { Appel, CallType, Tech } from "./types";

export type LatLng = { lat: number; lng: number };

export type TerritoryCity = {
  name: string;
  region: string;
  lat: number;
  lng: number;
  aliases?: string[];
};

/** Dépôt Guertech, 1000 rue Cormier, Drummondville. */
export const DEPOT: LatLng = { lat: 45.8968, lng: -72.5194 };

export const TERRITORY_CITIES: TerritoryCity[] = [
  { name: "Drummondville", region: "Centre-du-Québec", lat: 45.883, lng: -72.484 },
  { name: "Victoriaville", region: "Centre-du-Québec", lat: 46.055, lng: -71.965 },
  { name: "Nicolet", region: "Centre-du-Québec", lat: 46.226, lng: -72.615 },
  { name: "Bécancour", region: "Centre-du-Québec", lat: 46.349, lng: -72.433 },
  { name: "Plessisville", region: "Centre-du-Québec", lat: 46.218, lng: -71.778 },
  { name: "Trois-Rivières", region: "Mauricie", lat: 46.343, lng: -72.543 },
  { name: "Shawinigan", region: "Mauricie", lat: 46.567, lng: -72.753 },
  { name: "La Tuque", region: "Mauricie", lat: 47.443, lng: -72.783 },
  { name: "Sherbrooke", region: "Estrie", lat: 45.404, lng: -71.892 },
  { name: "Magog", region: "Estrie", lat: 45.267, lng: -72.148 },
  { name: "Granby", region: "Estrie", lat: 45.4, lng: -72.733 },
  { name: "Coaticook", region: "Estrie", lat: 45.133, lng: -71.799 },
  { name: "Lévis", region: "Chaudière-Appalaches", lat: 46.803, lng: -71.178 },
  { name: "Saint-Georges", region: "Chaudière-Appalaches", lat: 46.122, lng: -70.67 },
  { name: "Sainte-Marie", region: "Chaudière-Appalaches", lat: 46.434, lng: -71.012 },
  { name: "Thetford Mines", region: "Chaudière-Appalaches", lat: 46.094, lng: -71.306 },
  { name: "Montmagny", region: "Chaudière-Appalaches", lat: 46.98, lng: -70.555 },
  { name: "Sorel-Tracy", region: "Montérégie", lat: 46.042, lng: -73.114 },
  { name: "Saint-Hyacinthe", region: "Montérégie", lat: 45.63, lng: -72.957 },
  { name: "Longueuil", region: "Montérégie", lat: 45.531, lng: -73.518 },
  { name: "Brossard", region: "Montérégie", lat: 45.458, lng: -73.45 },
  { name: "Montréal", region: "Montréal", lat: 45.508, lng: -73.554, aliases: ["montreal"] },
  {
    name: "Sault Ste. Marie",
    region: "Nord de l'Ontario — P6",
    lat: 46.513,
    lng: -84.335,
    aliases: ["sault sainte marie", "sault ste marie"],
  },
  { name: "Wawa", region: "Nord de l'Ontario — P0", lat: 47.993, lng: -84.774 },
  {
    name: "Sept-Îles",
    region: "Côte-Nord",
    lat: 50.213,
    lng: -66.376,
    aliases: ["sept iles", "sept-iles"],
  },
  { name: "Corner Brook", region: "Terre-Neuve-et-Labrador", lat: 48.95, lng: -57.952 },
  { name: "Tillsonburg", region: "Sud-ouest de l'Ontario — N4", lat: 42.861, lng: -80.726 },
];

const BY_FOLD = new Map<string, TerritoryCity>();
for (const city of TERRITORY_CITIES) {
  BY_FOLD.set(fold(city.name), city);
  for (const alias of city.aliases ?? []) BY_FOLD.set(fold(alias), city);
}

const BY_LENGTH = [...TERRITORY_CITIES].sort(
  (a, b) => fold(b.name).length - fold(a.name).length,
);

export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cityFromText(value: string): TerritoryCity | null {
  const folded = fold(value);
  if (!folded) return null;
  const exact = BY_FOLD.get(folded);
  if (exact) return exact;
  for (const city of BY_LENGTH) {
    const name = fold(city.name);
    if (name.length < 4) {
      const small = new RegExp(`(?:^|\\s)${name}(?:\\s|$)`);
      if (small.test(folded)) return city;
      continue;
    }
    if (folded.includes(name)) return city;
  }
  return null;
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function jitter(city: TerritoryCity, address: string): LatLng {
  const hash = hashText(fold(address));
  const radiusKm = 0.4 + ((hash & 1023) / 1023) * 3.2;
  const angle = (((hash >>> 10) & 1023) / 1023) * Math.PI * 2;
  const lat = city.lat + (radiusKm * Math.cos(angle)) / 110.574;
  const lng =
    city.lng +
    (radiusKm * Math.sin(angle)) /
      (111.32 * Math.cos((city.lat * Math.PI) / 180));
  return { lat, lng };
}

export function hasCoordinates(point: {
  lat?: number;
  lng?: number;
}): point is LatLng {
  return (
    point.lat != null &&
    point.lng != null &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng)
  );
}

/** Coordonnées NetSuite, sinon ville connue. Jamais le dépôt par défaut. */
export function pointForAppel(appel: Pick<Appel, "lat" | "lng" | "ville" | "adresse">): LatLng | null {
  if (hasCoordinates(appel)) return { lat: appel.lat, lng: appel.lng };
  const city = cityFromText(appel.ville) ?? cityFromText(appel.adresse);
  if (!city) return null;
  return jitter(city, appel.adresse || appel.ville || city.name);
}

export function pointForStart(address: string | undefined): LatLng {
  const text = (address ?? "").trim();
  if (!text) return DEPOT;
  const folded = fold(text);
  if (
    folded.includes("cormier") ||
    folded.includes("100 1000") ||
    folded.includes("100-1000")
  ) {
    return DEPOT;
  }
  const city = cityFromText(text);
  if (city) return { lat: city.lat, lng: city.lng };
  return DEPOT;
}

const TECH_NAMES = [
  "William Villeneuve",
  "Marc Tremblay",
  "Sophie Gagnon",
  "Alex Nguyen",
  "Karine Bouchard",
  "Jean-Philippe Roy",
  "Nadia Fortin",
  "Luc Bergeron",
  "Amélie Côté",
  "Hugo Pelletier",
  "Chantal Morin",
  "Éric Lavoie",
  "Mélanie Gauthier",
  "Patrick Simard",
];

function offsetPoint(city: TerritoryCity, index: number): LatLng {
  const angle = ((index * 47) % 360) * (Math.PI / 180);
  const radiusKm = 0.5 + (index % 5) * 0.65;
  return {
    lat: city.lat + (radiusKm * Math.cos(angle)) / 110.574,
    lng:
      city.lng +
      (radiusKm * Math.sin(angle)) /
        (111.32 * Math.cos((city.lat * Math.PI) / 180)),
  };
}

/**
 * Jeu synthétique : territoire des 5 régions, Montréal, et les secteurs
 * éloignés vus en production (Sault, Wawa, Sept-Îles, Corner Brook, Tillsonburg).
 * Les techniciens n'ont pas de zone et partent du dépôt.
 */
export function productionScenario(options?: {
  calls?: number;
  techs?: number;
  asOf?: string;
}): { calls: Appel[]; techs: Tech[]; asOf: string } {
  const asOf = options?.asOf ?? "2026-11-11";
  const techCount = Math.min(TECH_NAMES.length, Math.max(1, options?.techs ?? 14));
  const callCount = Math.max(20, options?.calls ?? 300);
  const homeCities = TERRITORY_CITIES.filter((city) =>
    [
      "Centre-du-Québec",
      "Mauricie",
      "Estrie",
      "Chaudière-Appalaches",
      "Montérégie",
    ].includes(city.region),
  );
  const remotePlan: Array<{ city: TerritoryCity; type: CallType; count: number }> = [
    { city: cityFromText("Sault Ste. Marie")!, type: "reactif", count: 2 },
    { city: cityFromText("Sault Ste. Marie")!, type: "preventif", count: 2 },
    { city: cityFromText("Wawa")!, type: "reactif", count: 1 },
    { city: cityFromText("Wawa")!, type: "preventif", count: 1 },
    { city: cityFromText("Sept-Îles")!, type: "reactif", count: 1 },
    { city: cityFromText("Sept-Îles")!, type: "preventif", count: 1 },
    { city: cityFromText("Corner Brook")!, type: "reactif", count: 1 },
    { city: cityFromText("Tillsonburg")!, type: "reactif", count: 1 },
    { city: cityFromText("Montréal")!, type: "preventif", count: 4 },
    { city: cityFromText("Montréal")!, type: "reactif", count: 2 },
  ];

  const calls: Appel[] = [];
  const push = (city: TerritoryCity, type: CallType, openedAt: string) => {
    const index = calls.length + 1;
    const point = offsetPoint(city, index);
    const id = `C${String(index).padStart(4, "0")}`;
    calls.push({
      id,
      type,
      magasin: `${type === "reactif" ? "Réactif" : "Préventif"} ${city.name} ${index}`,
      adresse: `${100 + (index % 80)} rue Principale, ${city.name}`,
      ville: city.name,
      region: city.region,
      lat: point.lat,
      lng: point.lng,
      equipement: "Espresso",
      equipementId: 2,
      netsuiteId: id,
      planifie: false,
      heure: "",
      techId: "",
      openedAt,
    });
  };

  for (const item of remotePlan) {
    for (let copy = 0; copy < item.count; copy += 1) {
      push(item.city, item.type, item.type === "reactif" ? "2026-11-04" : "2026-09-01");
    }
  }

  let cursor = 0;
  while (calls.length < callCount) {
    const city = homeCities[cursor % homeCities.length];
    const reactive = calls.length % 7 === 0;
    const openedAt = reactive
      ? calls.length % 14 === 0
        ? "2026-11-06"
        : calls.length % 2 === 0
          ? "2026-11-10"
          : asOf
      : "2026-09-15";
    push(city, reactive ? "reactif" : "preventif", openedAt);
    cursor += 1;
  }

  const techs: Tech[] = TECH_NAMES.slice(0, techCount).map((name, index) => ({
    id: String(index + 1),
    name,
    present: true,
    start: DRUMMONDVILLE_HQ,
    end: DRUMMONDVILLE_HQ,
    startHour: "08:00",
    endHour: "17:00",
    hours: 9,
    region: "",
    skills: [...ALL_SKILL_IDS],
  }));

  return { calls, techs, asOf };
}
