import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { clearNetsuiteCache } from "./cache";
import { createNetsuiteClient, type NetsuiteClient } from "./client";
import { caseRecordBody, parseDispatchBody, taskRecordBody } from "./dispatch";
import {
  readAppelsResponse,
  readTechsResponse,
  writeDispatchResponse,
} from "./handlers";
import { APPELS_SUITEQL } from "./queries";

const ENV = {
  NETSUITE_ACCOUNT_ID: "9394021_SB1",
  NETSUITE_CONSUMER_KEY: "consumer-key-test",
  NETSUITE_CONSUMER_SECRET: "consumer-secret-DO-NOT-LEAK",
  NETSUITE_TOKEN_ID: "token-id-test",
  NETSUITE_TOKEN_SECRET: "token-secret-DO-NOT-LEAK",
};

afterEach(() => {
  clearNetsuiteCache();
});

describe("réponses API NetSuite", { concurrency: 1 }, () => {
  it("renvoie le mode démo sans variables", async () => {
    const appels = await readAppelsResponse({});
    const techs = await readTechsResponse({});
    assert.deepEqual(appels, { status: 200, body: { demo: true } });
    assert.deepEqual(techs, { status: 200, body: { demo: true } });
  });

  it("page SuiteQL et mappe les lignes", async () => {
    const seen: string[] = [];
    const client: NetsuiteClient = {
      async suiteql(query, options) {
        seen.push(`${query.slice(0, 12)}:${options?.offset}`);
        if ((options?.offset ?? 0) === 0) {
          return {
            items: [
              {
                task_id: "41",
                case_id: "42",
                case_type: "7",
                site: "Metro",
                address: "225 rue Royale, Trois-Rivières, QC",
                asset: "Filtration d'eau",
              },
            ],
            hasMore: true,
            count: 1,
            offset: 0,
            totalResults: 2,
          };
        }
        return {
          items: [
            {
              task_id: "43",
              case_id: "44",
              case_type: "6",
              site: "IGA",
              address: "640 rue Laurier, Victoriaville, QC",
              asset: "Espresso",
              tech_id: "35274",
            },
          ],
          hasMore: false,
          count: 1,
          offset: 1000,
          totalResults: 2,
        };
      },
      async suiteqlAll(query) {
        const first = await this.suiteql(query, { limit: 1000, offset: 0 });
        const second = await this.suiteql(query, { limit: 1000, offset: 1000 });
        return [...first.items, ...second.items];
      },
      async patchRecord() {
        throw new Error("pas d'écriture");
      },
    };

    const result = await readAppelsResponse(ENV, client);
    assert.equal(result.status, 200);
    const body = result.body as { demo: boolean; appels: { id: string; planifie: boolean }[] };
    assert.equal(body.demo, false);
    assert.deepEqual(
      body.appels.map((appel) => appel.id),
      ["41", "43"],
    );
    assert.equal(body.appels[1]?.planifie, false);
    assert.equal(seen.length, 2);

    const cached = await readAppelsResponse(ENV, client);
    assert.equal(seen.length, 2);
    assert.equal((cached.body as { appels: unknown[] }).appels.length, 2);
  });

  it("refuse l'écriture tant que le drapeau n'est pas true", async () => {
    const blocked = await writeDispatchResponse(
      [{ taskId: "1", techId: "2", date: "2026-11-10" }],
      ENV,
    );
    assert.equal(blocked.status, 403);

    const missing = await writeDispatchResponse(
      [{ taskId: "1", techId: "2", date: "2026-11-10" }],
      { ...ENV, NETSUITE_WRITE_ENABLED: "false" },
    );
    assert.equal(missing.status, 403);

    const unconfigured = await writeDispatchResponse([], {});
    assert.equal(unconfigured.status, 503);
  });

  it("envoie le PATCH de tâche et le statut de cas quand l'écriture est active", async () => {
    const patches: { type: string; id: string; body: Record<string, unknown> }[] =
      [];
    const client: NetsuiteClient = {
      async suiteql() {
        throw new Error("inutile");
      },
      async suiteqlAll() {
        return [];
      },
      async patchRecord(type, id, body) {
        patches.push({ type, id, body });
      },
    };
    const payload = [
      {
        taskId: "501",
        techId: "77",
        date: "2026-11-10",
        heure: "09:30",
        status: "NOTSTART",
        caseId: "800",
        caseStatus: "1",
      },
    ];
    const result = await writeDispatchResponse(
      payload,
      { ...ENV, NETSUITE_WRITE_ENABLED: "true" },
      client,
    );
    assert.equal(result.status, 200);
    assert.deepEqual(patches, [
      {
        type: "task",
        id: "501",
        body: {
          assigned: { id: "77" },
          startDate: "2026-11-10",
          dueDate: "2026-11-10",
          status: "NOTSTART",
          startTime: "09:30:00",
        },
      },
      {
        type: "supportcase",
        id: "800",
        body: { status: { id: "1" } },
      },
    ]);
  });

  it("valide le corps et construit le PATCH documenté", () => {
    const [item] = parseDispatchBody([
      { taskId: "10", techId: "11", date: "2026-11-10" },
    ]);
    assert.equal(item?.status, "NOTSTART");
    assert.deepEqual(taskRecordBody(item!), {
      assigned: { id: "11" },
      startDate: "2026-11-10",
      dueDate: "2026-11-10",
      status: "NOTSTART",
    });
    assert.deepEqual(caseRecordBody("1"), { status: { id: "1" } });
    assert.throws(
      () => parseDispatchBody([{ taskId: "x", techId: "1", date: "2026-11-10" }]),
      /taskId/,
    );
  });
});

describe("client HTTP mocké", { concurrency: 1 }, () => {
  it("pose Prefer transient, signe la query et pagine hasMore", async () => {
    const urls: string[] = [];
    const prefers: Array<string | null> = [];
    const client = createNetsuiteClient({
      env: ENV,
      nonce: () => "n",
      timestamp: () => "1700000000",
      fetchImpl: async (input, init) => {
        const url = String(input);
        urls.push(url);
        const headers = new Headers(init?.headers);
        prefers.push(headers.get("Prefer"));
        const authorization = headers.get("Authorization") ?? "";
        assert.match(authorization, /^OAuth /);
        assert.equal(
          authorization.includes("consumer-secret-DO-NOT-LEAK"),
          false,
        );
        assert.equal(authorization.includes("token-secret-DO-NOT-LEAK"), false);
        assert.match(url, /9394021-sb1\.suitetalk\.api\.netsuite\.com/);
        const offset = Number(new URL(url).searchParams.get("offset"));
        const payload =
          offset === 0
            ? { items: [{ id: "1" }], hasMore: true, count: 1, offset: 0 }
            : { items: [{ id: "2" }], hasMore: false, count: 1, offset: 1000 };
        return new Response(JSON.stringify(payload), { status: 200 });
      },
    });

    const rows = await client.suiteqlAll(APPELS_SUITEQL);
    assert.equal(rows.length, 2);
    assert.deepEqual(prefers, ["transient", "transient"]);
    assert.match(urls[0] ?? "", /limit=1000/);
    assert.match(urls[0] ?? "", /offset=0/);
    assert.match(urls[1] ?? "", /offset=1/);
  });

  it("masque les secrets dans l'erreur NetSuite", async () => {
    const client = createNetsuiteClient({
      env: ENV,
      nonce: () => "n",
      timestamp: () => "1700000000",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            title: "Invalid",
            "o:errorDetails": [
              { detail: "mauvais jeton token-secret-DO-NOT-LEAK" },
            ],
          }),
          { status: 401 },
        ),
    });
    await assert.rejects(
      () => client.patchRecord("task", "15", { status: "NOTSTART" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /401/);
        assert.equal(error.message.includes("token-secret-DO-NOT-LEAK"), false);
        assert.equal(
          error.message.includes("consumer-secret-DO-NOT-LEAK"),
          false,
        );
        return true;
      },
    );
  });
});
