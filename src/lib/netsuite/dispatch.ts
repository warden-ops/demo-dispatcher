export const TASK_STATUSES = ["NOTSTART", "PROGRESS", "COMPLETE"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type DispatchAssignment = {
  taskId: string;
  techId: string;
  date: string;
  heure?: string;
  status: TaskStatus;
  caseId?: string;
  caseStatus?: string;
};

export class DispatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchValidationError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^\d+$/;

function asRecord(value: unknown, index: number): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DispatchValidationError(
      `Affectation ${index + 1} : objet attendu.`,
    );
  }
  return value as Record<string, unknown>;
}

function requiredId(
  value: unknown,
  label: string,
  index: number,
): string {
  const text = String(value ?? "").trim();
  if (!ID_RE.test(text)) {
    throw new DispatchValidationError(
      `Affectation ${index + 1} : ${label} numérique obligatoire.`,
    );
  }
  return text;
}

export function parseDispatchBody(input: unknown): DispatchAssignment[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new DispatchValidationError(
      "Le corps doit être une liste d'affectations non vide.",
    );
  }
  if (input.length > 200) {
    throw new DispatchValidationError(
      "Trop d'affectations dans une seule requête (maximum 200).",
    );
  }

  return input.map((item, index) => {
    const record = asRecord(item, index);
    const taskId = requiredId(record.taskId, "taskId", index);
    const techId = requiredId(record.techId, "techId", index);
    const date = String(record.date ?? "").trim();
    if (!DATE_RE.test(date)) {
      throw new DispatchValidationError(
        `Affectation ${index + 1} : date attendue au format YYYY-MM-DD.`,
      );
    }
    const statusRaw = String(record.status ?? "NOTSTART").trim();
    if (!TASK_STATUSES.includes(statusRaw as TaskStatus)) {
      throw new DispatchValidationError(
        `Affectation ${index + 1} : statut de tâche invalide.`,
      );
    }
    let heure: string | undefined;
    if (record.heure != null && String(record.heure).trim() !== "") {
      heure = String(record.heure).trim();
      if (!HEURE_RE.test(heure)) {
        throw new DispatchValidationError(
          `Affectation ${index + 1} : heure attendue au format HH:MM.`,
        );
      }
    }
    let caseId: string | undefined;
    let caseStatus: string | undefined;
    if (record.caseId != null && String(record.caseId).trim() !== "") {
      caseId = requiredId(record.caseId, "caseId", index);
    }
    if (record.caseStatus != null && String(record.caseStatus).trim() !== "") {
      caseStatus = requiredId(record.caseStatus, "caseStatus", index);
    }
    if (caseStatus && !caseId) {
      throw new DispatchValidationError(
        `Affectation ${index + 1} : caseStatus exige un caseId.`,
      );
    }
    return {
      taskId,
      techId,
      date,
      heure,
      status: statusRaw as TaskStatus,
      caseId,
      caseStatus,
    };
  });
}

/** Corps PATCH /record/v1/task/{id}. */
export function taskRecordBody(
  item: DispatchAssignment,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    assigned: { id: item.techId },
    startDate: item.date,
    dueDate: item.date,
    status: item.status,
  };
  if (item.heure) body.startTime = `${item.heure}:00`;
  return body;
}

/** Corps PATCH /record/v1/supportcase/{id}. 1 = Reparti. */
export function caseRecordBody(caseStatus: string): Record<string, unknown> {
  return { status: { id: caseStatus } };
}
