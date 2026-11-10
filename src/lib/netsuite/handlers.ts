import { cachedRead, clearNetsuiteCache } from "./cache";
import { createNetsuiteClient, type NetsuiteClient } from "./client";
import {
  isNetsuiteConfigured,
  isNetsuiteWriteEnabled,
  type EnvMap,
} from "./config";
import {
  caseRecordBody,
  DispatchValidationError,
  parseDispatchBody,
  taskRecordBody,
} from "./dispatch";
import {
  mapAppelRows,
  mapCustomerRows,
  mapItemRows,
  mapTechRows,
} from "./mapping";
import {
  APPELS_SUITEQL,
  CUSTOMERS_SUITEQL,
  ITEMS_SUITEQL,
  TECHS_SUITEQL,
} from "./queries";

export type JsonResult = {
  status: number;
  body: unknown;
};

function publicMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Lecture NetSuite impossible.";
}

function clientOrCreate(
  env: EnvMap,
  client?: NetsuiteClient,
): NetsuiteClient {
  return client ?? createNetsuiteClient({ env });
}

export async function readAppelsResponse(
  env: EnvMap = process.env,
  client?: NetsuiteClient,
): Promise<JsonResult> {
  if (!isNetsuiteConfigured(env)) {
    return { status: 200, body: { demo: true } };
  }
  try {
    const api = clientOrCreate(env, client);
    const appels = await cachedRead("appels", async () =>
      mapAppelRows(await api.suiteqlAll(APPELS_SUITEQL)),
    );
    return { status: 200, body: { demo: false, appels } };
  } catch (error) {
    return { status: 502, body: { error: publicMessage(error) } };
  }
}

export async function readTechsResponse(
  env: EnvMap = process.env,
  client?: NetsuiteClient,
): Promise<JsonResult> {
  if (!isNetsuiteConfigured(env)) {
    return { status: 200, body: { demo: true } };
  }
  try {
    const api = clientOrCreate(env, client);
    const techs = await cachedRead("techs", async () =>
      mapTechRows(await api.suiteqlAll(TECHS_SUITEQL)),
    );
    return { status: 200, body: { demo: false, techs } };
  } catch (error) {
    return { status: 502, body: { error: publicMessage(error) } };
  }
}

export async function readCustomersResponse(
  env: EnvMap = process.env,
  client?: NetsuiteClient,
): Promise<JsonResult> {
  if (!isNetsuiteConfigured(env)) {
    return { status: 200, body: { demo: true } };
  }
  try {
    const api = clientOrCreate(env, client);
    const customers = await cachedRead("customers", async () =>
      mapCustomerRows(await api.suiteqlAll(CUSTOMERS_SUITEQL)),
    );
    return { status: 200, body: { demo: false, customers } };
  } catch (error) {
    return { status: 502, body: { error: publicMessage(error) } };
  }
}

export async function readItemsResponse(
  env: EnvMap = process.env,
  client?: NetsuiteClient,
): Promise<JsonResult> {
  if (!isNetsuiteConfigured(env)) {
    return { status: 200, body: { demo: true } };
  }
  try {
    const api = clientOrCreate(env, client);
    const items = await cachedRead("items", async () =>
      mapItemRows(await api.suiteqlAll(ITEMS_SUITEQL)),
    );
    return { status: 200, body: { demo: false, items } };
  } catch (error) {
    return { status: 502, body: { error: publicMessage(error) } };
  }
}

export async function writeDispatchResponse(
  payload: unknown,
  env: EnvMap = process.env,
  client?: NetsuiteClient,
): Promise<JsonResult> {
  if (!isNetsuiteConfigured(env)) {
    return {
      status: 503,
      body: { error: "NetSuite n'est pas configuré." },
    };
  }
  if (!isNetsuiteWriteEnabled(env)) {
    return {
      status: 403,
      body: {
        error:
          "Écriture NetSuite désactivée. Définissez NETSUITE_WRITE_ENABLED=true pour autoriser l'envoi.",
      },
    };
  }

  let assignments;
  try {
    assignments = parseDispatchBody(payload);
  } catch (error) {
    const message =
      error instanceof DispatchValidationError
        ? error.message
        : "Requête invalide.";
    return { status: 400, body: { error: message } };
  }

  const api = clientOrCreate(env, client);
  const results: { taskId: string; ok: boolean; error?: string }[] = [];
  for (const assignment of assignments) {
    try {
      await api.patchRecord(
        "task",
        assignment.taskId,
        taskRecordBody(assignment),
      );
      if (assignment.caseId && assignment.caseStatus) {
        await api.patchRecord(
          "supportcase",
          assignment.caseId,
          caseRecordBody(assignment.caseStatus),
        );
      }
      results.push({ taskId: assignment.taskId, ok: true });
    } catch (error) {
      results.push({
        taskId: assignment.taskId,
        ok: false,
        error: publicMessage(error),
      });
    }
  }

  const updated = results.filter((result) => result.ok).length;
  const failed = results.length - updated;
  if (updated > 0) clearNetsuiteCache();
  if (updated === 0) {
    return {
      status: 502,
      body: {
        ok: false,
        updated,
        failed,
        results,
        error: results.find((result) => result.error)?.error ?? "Échec NetSuite.",
      },
    };
  }
  return { status: 200, body: { ok: failed === 0, updated, failed, results } };
}
