import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cachedRead,
  clearNetsuiteCache,
  NETSUITE_CACHE_TTL_MS,
  readCache,
  writeCache,
} from "./cache";

describe("cache NetSuite", { concurrency: 1 }, () => {
  it("conserve une lecture 60 secondes puis l'oublie", () => {
    clearNetsuiteCache();
    const start = 1_000_000;
    writeCache("appels", [{ id: "1" }], start);
    assert.deepEqual(readCache("appels", start + NETSUITE_CACHE_TTL_MS - 1), [
      { id: "1" },
    ]);
    assert.equal(readCache("appels", start + NETSUITE_CACHE_TTL_MS), undefined);
    clearNetsuiteCache();
  });

  it("ne rappelle pas le chargeur tant que l'entrée est fraîche", async () => {
    clearNetsuiteCache();
    let calls = 0;
    const now = 5_000;
    const first = await cachedRead(
      "techs",
      async () => {
        calls += 1;
        return ["a"];
      },
      now,
    );
    const second = await cachedRead(
      "techs",
      async () => {
        calls += 1;
        return ["b"];
      },
      now + 1_000,
    );
    assert.deepEqual(first, ["a"]);
    assert.deepEqual(second, ["a"]);
    assert.equal(calls, 1);
    clearNetsuiteCache();
  });
});
