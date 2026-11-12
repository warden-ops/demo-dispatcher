import {
  ALL_SKILL_IDS,
  DRUMMONDVILLE_HQ,
  EQUIPMENT,
} from "../guertech/constants";
import type { Appel, CallType, Tech } from "../guertech/types";
import {
  deriveRegion,
  formatPlaceName,
  normalizeLookup,
  normalizePostal,
  normalizeProvince,
  parseAddressText,
  villeFromAddress,
} from "./address";

export { normalizeLookup, villeFromAddress };

/** Files d'attente, pas des techniciens sur la route. */
export const PLACEHOLDER_TECH_IDS = new Set(["35274", "228238"]);

export const TECH_DEPARTMENTS = [
  "Technique",
  "Technicien mobile",
  "Atelier",
] as const;

export type NetsuiteCustomer = {
  id: string;
  name: string;
  email: string;
};

export type NetsuiteItem = {
  id: string;
  name: string;
  itemType: string;
};

export function cell(row: Record<string, unknown>, key: string): string {
  const direct = row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()];
  if (direct == null) return "";
  return String(direct).trim();
}

export function normalizeHeure(value: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "";
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function plainId(value: string): string {
  if (/^\d+$/.test(value)) return value;
  if (/^\d+\.0+$/.test(value)) return value.replace(/\.0+$/, "");
  return value;
}

function firstFilled(...values: string[]): string {
  return values.find((value) => value.trim())?.trim() ?? "";
}

function readLatLng(lat: string, lng: string): { lat: number; lng: number } | null {
  if (!lat || !lng) return null;
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { lat: latitude, lng: longitude };
}

export function matchEquipment(name: string): {
  equipement: string;
  equipementId: number;
} {
  const label = name.trim();
  if (!label) return { equipement: "Équipement non précisé", equipementId: 0 };
  const normalized = normalizeLookup(label);
  const exact = EQUIPMENT.find(
    (item) => normalizeLookup(item.name) === normalized,
  );
  if (exact) return { equipement: exact.name, equipementId: exact.id };
  const partial = EQUIPMENT.find((item) => {
    const needle = normalizeLookup(item.name);
    return needle.length >= 4 && normalized.includes(needle);
  });
  if (partial) return { equipement: partial.name, equipementId: partial.id };
  return { equipement: label, equipementId: 0 };
}

function caseType(value: string): CallType | null {
  const code = Number(value);
  if (code === 6) return "preventif";
  if (code === 7) return "reactif";
  return null;
}

function coordinateAddress(lat: string, lng: string): string {
  if (!lat || !lng) return "";
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  return `${lat},${lng}`;
}

export function mapAppelRow(row: Record<string, unknown>): Appel | null {
  const taskId = plainId(cell(row, "task_id"));
  const type = caseType(cell(row, "case_type"));
  if (!/^\d+$/.test(taskId) || !type) return null;

  const caseId = plainId(cell(row, "case_id"));
  const caseNumber = cell(row, "casenumber");
  const site = cell(row, "site") || cell(row, "customer") || "Site sans nom";
  const address =
    cell(row, "address") ||
    coordinateAddress(cell(row, "lat"), cell(row, "lng"));
  const parsed = parseAddressText(address);
  const ville = formatPlaceName(
    firstFilled(
      cell(row, "site_city"),
      cell(row, "customer_city"),
      cell(row, "city"),
      parsed.ville,
    ),
  );
  const province =
    normalizeProvince(
      firstFilled(
        cell(row, "site_state"),
        cell(row, "customer_state"),
        cell(row, "state"),
      ),
    ) || parsed.province;
  const postal =
    normalizePostal(
      firstFilled(
        cell(row, "site_zip"),
        cell(row, "customer_zip"),
        cell(row, "zip"),
      ),
    ) || parsed.postal;
  const coords = readLatLng(cell(row, "lat"), cell(row, "lng"));
  const equipment = matchEquipment(cell(row, "asset"));
  const rawTech = plainId(cell(row, "tech_id"));
  const techId =
    rawTech && !PLACEHOLDER_TECH_IDS.has(rawTech) && /^\d+$/.test(rawTech)
      ? rawTech
      : "";
  const heure = normalizeHeure(cell(row, "start_time"));
  const scheduledOn = cell(row, "start_date");
  const openedAt = cell(row, "opened_at") || scheduledOn;

  return {
    id: taskId,
    type,
    magasin: caseNumber ? `${caseNumber} · ${site}` : site,
    adresse: address,
    ville,
    region: deriveRegion({ ville, province, postal }),
    ...(coords ?? {}),
    equipement: equipment.equipement,
    equipementId: equipment.equipementId,
    netsuiteId: /^\d+$/.test(caseId) ? caseId : caseNumber || taskId,
    planifie: Boolean(techId),
    heure,
    techId,
    openedAt,
    ...(scheduledOn ? { scheduledOn } : {}),
  };
}

export function mapAppelRows(rows: Record<string, unknown>[]): Appel[] {
  const seen = new Set<string>();
  const appels: Appel[] = [];
  for (const row of rows) {
    const appel = mapAppelRow(row);
    if (!appel || seen.has(appel.id)) continue;
    seen.add(appel.id);
    appels.push(appel);
  }
  return appels;
}

function departmentAllowed(department: string): boolean {
  const normalized = normalizeLookup(department);
  return TECH_DEPARTMENTS.some(
    (name) => normalizeLookup(name) === normalized,
  );
}

export function mapTechRow(row: Record<string, unknown>): Tech | null {
  const id = plainId(cell(row, "id"));
  if (!/^\d+$/.test(id) || PLACEHOLDER_TECH_IDS.has(id)) return null;
  const department = cell(row, "department");
  if (!departmentAllowed(department)) return null;

  const person =
    [cell(row, "firstname"), cell(row, "lastname")].filter(Boolean).join(" ") ||
    cell(row, "entityid") ||
    `Technicien ${id}`;

  const ville = cell(row, "city");
  const location = cell(row, "location");
  return {
    id,
    name: `${person} · ${department}`,
    present: false,
    start: DRUMMONDVILLE_HQ,
    end: DRUMMONDVILLE_HQ,
    startHour: "",
    endHour: "",
    hours: 0,
    region: deriveRegion({
      ville,
      province: cell(row, "state"),
      postal: cell(row, "zip"),
      explicit: location,
    }),
    skills: [...ALL_SKILL_IDS, 0],
  };
}

export function mapTechRows(rows: Record<string, unknown>[]): Tech[] {
  const seen = new Set<string>();
  const techs: Tech[] = [];
  for (const row of rows) {
    const tech = mapTechRow(row);
    if (!tech || seen.has(tech.id)) continue;
    seen.add(tech.id);
    techs.push(tech);
  }
  return techs;
}

export function mapCustomerRows(
  rows: Record<string, unknown>[],
): NetsuiteCustomer[] {
  return rows.flatMap((row) => {
    const id = plainId(cell(row, "id"));
    if (!/^\d+$/.test(id)) return [];
    const name =
      cell(row, "companyname") || cell(row, "entityid") || `Client ${id}`;
    return [{ id, name, email: cell(row, "email") }];
  });
}

export function mapItemRows(rows: Record<string, unknown>[]): NetsuiteItem[] {
  return rows.flatMap((row) => {
    const id = plainId(cell(row, "id"));
    if (!/^\d+$/.test(id)) return [];
    const name =
      cell(row, "displayname") || cell(row, "itemid") || `Article ${id}`;
    return [{ id, name, itemType: cell(row, "itemtype") }];
  });
}
