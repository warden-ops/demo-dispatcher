import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadAppels } from "./csv";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("chargement des appels", () => {
  it("garde le CSV de démo quand NetSuite répond demo", async () => {
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/api/netsuite/")) {
        return new Response(JSON.stringify({ demo: true }), { status: 200 });
      }
      return new Response(
        [
          "id,type,magasin,adresse,ville,region,equipement,equipement_id,netsuite_id,planifie,heure,tech_id,opened_at",
          "NS-1,reactif,Metro,1 rue Royale,Trois-Rivières,Mauricie,Espresso,2,NS-1,1,09:00,5,2026-11-01",
        ].join("\n"),
        { status: 200 },
      );
    };

    const loaded = await loadAppels();
    assert.equal(loaded.source, "demo");
    assert.equal(loaded.techs, null);
    assert.equal(loaded.appels.length, 1);
    assert.equal(loaded.appels[0]?.id, "NS-1");
    assert.equal(loaded.appels[0]?.planifie, true);
    assert.equal(urls.some((url) => url.includes("/api/netsuite/appels")), true);
    assert.equal(urls.some((url) => url.includes("appels.csv")), true);
  });

  it("prend les appels et techniciens NetSuite quand le sandbox répond", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/api/netsuite/appels")) {
        return new Response(
          JSON.stringify({
            demo: false,
            appels: [
              {
                id: "41",
                type: "reactif",
                magasin: "Metro",
                adresse: "1 rue Royale",
                ville: "Trois-Rivières",
                region: "Mauricie",
                equipement: "Espresso",
                equipementId: 2,
                netsuiteId: "42",
                planifie: true,
                heure: "09:00",
                techId: "77",
                openedAt: "2026-11-01",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/api/netsuite/techs")) {
        return new Response(
          JSON.stringify({
            demo: false,
            techs: [
              {
                id: "77",
                name: "Marie Roy",
                present: false,
                start: "siège",
                end: "siège",
                startHour: "",
                endHour: "",
                hours: 0,
                region: "",
                skills: [2],
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`appel inattendu ${url}`);
    };

    const loaded = await loadAppels();
    assert.equal(loaded.source, "netsuite");
    assert.equal(loaded.appels[0]?.techId, "77");
    assert.equal(loaded.techs?.[0]?.name, "Marie Roy");
  });

  it("remonte l'erreur NetSuite au lieu de basculer en silence", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/appels")) {
        return new Response(
          JSON.stringify({ error: "NetSuite a répondu 401." }),
          { status: 502 },
        );
      }
      return new Response(JSON.stringify({ demo: true }), { status: 200 });
    };
    await assert.rejects(() => loadAppels(), /401/);
  });
});
