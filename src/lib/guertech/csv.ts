import type { Appel, CallType, Tech } from "./types";

export type DispatchLoad = {
  appels: Appel[];
  techs: Tech[] | null;
  source: "netsuite" | "demo";
  warning: string | null;
};

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

async function loadCsvAppels(): Promise<Appel[]> {
  const response = await fetch("/dispatch-v2/appels.csv", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Impossible de charger la liste d'appels.");
  }
  const text = await response.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]);
  const index = Object.fromEntries(header.map((key, i) => [key, i]));

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const type = (cells[index.type] === "reactif" ? "reactif" : "preventif") as CallType;
    return {
      id: cells[index.id],
      type,
      magasin: cells[index.magasin],
      adresse: cells[index.adresse],
      ville: cells[index.ville],
      region: cells[index.region],
      equipement: cells[index.equipement],
      equipementId: Number(cells[index.equipement_id] || 0),
      netsuiteId: cells[index.netsuite_id],
      planifie: cells[index.planifie] === "1" || cells[index.planifie] === "true",
      heure: cells[index.heure] ?? "",
      techId: cells[index.tech_id] ?? "",
      openedAt: cells[index.opened_at] || "2026-08-13",
    };
  });
}

type JsonRecord = { demo?: boolean; error?: string; appels?: Appel[]; techs?: Tech[] };

async function readJson(response: Response): Promise<JsonRecord | null> {
  try {
    return (await response.json()) as JsonRecord;
  } catch {
    return null;
  }
}

/**
 * Essaie NetSuite d'abord. Sans variables TBA, l'API répond { demo: true }
 * et on garde le CSV de démo. Une erreur NetSuite (502) n'est pas masquée.
 */
export async function loadAppels(): Promise<DispatchLoad> {
  let appelsResponse: Response;
  let techsResponse: Response;
  try {
    [appelsResponse, techsResponse] = await Promise.all([
      fetch("/api/netsuite/appels", { cache: "no-store" }),
      fetch("/api/netsuite/techs", { cache: "no-store" }),
    ]);
  } catch {
    const appels = await loadCsvAppels();
    return { appels, techs: null, source: "demo", warning: null };
  }

  if (!appelsResponse.ok) {
    const body = await readJson(appelsResponse);
    throw new Error(body?.error || "Lecture des appels NetSuite impossible.");
  }

  const appelsBody = await readJson(appelsResponse);
  if (appelsBody?.demo === true || !Array.isArray(appelsBody?.appels)) {
    const appels = await loadCsvAppels();
    return { appels, techs: null, source: "demo", warning: null };
  }

  let techs: Tech[] | null = null;
  let warning: string | null = null;
  if (techsResponse.ok) {
    const techsBody = await readJson(techsResponse);
    if (techsBody?.demo !== true && Array.isArray(techsBody?.techs)) {
      techs = techsBody.techs;
    }
  } else {
    const techsBody = await readJson(techsResponse);
    warning =
      techsBody?.error ||
      "Appels NetSuite chargés, techniciens indisponibles.";
  }

  return {
    appels: appelsBody.appels,
    techs,
    source: "netsuite",
    warning,
  };
}
