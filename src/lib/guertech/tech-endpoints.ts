import { DRUMMONDVILLE_HQ } from "./constants";
import type { TechBase } from "./tech-bases.data";
import type { HomeBase } from "./tech-home-bases";
import { cityFromText, DEPOT, fold, pointForPostal, type LatLng } from "./territory";
import type { Tech } from "./types";

export type EndpointKind = "dépôt" | "domicile" | "estimé" | "saisi";

export type ResolvedEndpoint = LatLng & {
  kind: EndpointKind;
  label: string;
  /** Adresse à transmettre à Google (itinéraire détaillé). */
  address: string;
  /** Adresse saisie que l'on n'a pas su placer : dépôt utilisé à la place. */
  unresolved?: string;
};

export type EndpointOptions = {
  /** Domiciles fixes (départ et retour). {} : tout le monde au dépôt. */
  homeBases: Record<string, HomeBase>;
  /** Départs estimés (premier arrêt habituel). Désactivés par défaut. */
  estimatedBases?: Record<string, TechBase>;
};

const POSTAL = /\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/i;

function postalOf(text: string): string | null {
  const match = POSTAL.exec(text);
  return match ? `${match[1]}${match[2]}`.toUpperCase() : null;
}

function sameAddress(text: string, address: string): boolean {
  const a = fold(text).replace(/,/g, " ").replace(/\s+/g, " ");
  const b = fold(address).replace(/,/g, " ").replace(/\s+/g, " ");
  if (!a) return false;
  if (a === b) return true;
  const postal = postalOf(text);
  if (!postal || postal !== postalOf(address)) return false;
  // Même code postal et même numéro civique.
  const civic = /^\s*(\d+)/.exec(a)?.[1];
  return Boolean(civic) && civic === /^\s*(\d+)/.exec(b)?.[1];
}

export function isDepotAddress(text: string | undefined): boolean {
  const value = (text ?? "").trim();
  if (!value) return false;
  if (value.toLowerCase() === DRUMMONDVILLE_HQ.toLowerCase()) return true;
  const folded = fold(value);
  return (
    folded.includes("cormier") ||
    folded.includes("100 1000") ||
    folded === "depot" ||
    folded === "depot guertech"
  );
}

/**
 * Valeur par défaut : champ vide, adresse du dépôt préremplie par NetSuite, ou
 * domicile fixe prérempli pour ce technicien. Tout le reste est une saisie.
 */
export function isDefaultEndpoint(
  text: string | undefined,
  techId: string,
  configured: Record<string, HomeBase>,
): boolean {
  const value = (text ?? "").trim();
  if (!value) return true;
  if (value.toLowerCase() === DRUMMONDVILLE_HQ.toLowerCase()) return true;
  const own = configured[techId];
  return Boolean(own && sameAddress(value, own.address));
}

/** Adresse saisie : dépôt, domicile connu, ville connue ou code postal connu. */
export function pointForTypedAddress(
  text: string,
  homeBases: Record<string, HomeBase>,
): LatLng | null {
  const value = text.trim();
  if (!value) return null;
  if (isDepotAddress(value)) return DEPOT;
  for (const base of Object.values(homeBases)) {
    if (sameAddress(value, base.address)) return { lat: base.lat, lng: base.lng };
  }
  const city = cityFromText(value);
  if (city) return { lat: city.lat, lng: city.lng };
  return pointForPostal(value);
}

function depot(): ResolvedEndpoint {
  return { ...DEPOT, kind: "dépôt", label: "Dépôt", address: DRUMMONDVILLE_HQ };
}

function typed(text: string, homeBases: Record<string, HomeBase>): ResolvedEndpoint {
  const point = pointForTypedAddress(text, homeBases);
  if (!point) return { ...depot(), unresolved: text.trim() };
  if (isDepotAddress(text)) return depot();
  return { ...point, kind: "saisi", label: text.trim(), address: text.trim() };
}

/**
 * Départ et retour d'un technicien. Ordre de priorité, pour chaque champ :
 * adresse saisie, domicile fixe, départ estimé (si activé), dépôt.
 */
export function resolveTechEndpoints(
  tech: Pick<Tech, "id" | "start" | "end">,
  options: EndpointOptions,
  /** Domiciles configurés, même s'ils sont désactivés (pour reconnaître le préremplissage). */
  configured: Record<string, HomeBase> = options.homeBases,
): { start: ResolvedEndpoint; end: ResolvedEndpoint } {
  const home = options.homeBases[tech.id];
  const estimated = options.estimatedBases?.[tech.id];
  const known = { ...configured, ...options.homeBases };

  let start: ResolvedEndpoint;
  if (!isDefaultEndpoint(tech.start, tech.id, known)) {
    start = typed(tech.start, known);
  } else if (home) {
    start = { lat: home.lat, lng: home.lng, kind: "domicile", label: home.label, address: home.address };
  } else if (estimated) {
    start = {
      lat: estimated.lat,
      lng: estimated.lng,
      kind: "estimé",
      label: estimated.label,
      address: `${estimated.lat},${estimated.lng}`,
    };
  } else {
    start = depot();
  }

  let end: ResolvedEndpoint;
  if (!isDefaultEndpoint(tech.end, tech.id, known)) {
    end = typed(tech.end, known);
  } else if (home?.returnsHome) {
    end = { lat: home.lat, lng: home.lng, kind: "domicile", label: home.label, address: home.address };
  } else if (estimated && start.kind === "estimé") {
    end = { ...start };
  } else {
    end = depot();
  }
  return { start, end };
}
