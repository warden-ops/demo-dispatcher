import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { netsuiteRestHost } from "./config";
import {
  buildAuthorization,
  percentEncode,
  signatureBaseString,
} from "./oauth";

const FIXED_URL =
  "https://9394021-sb1.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1000&offset=0";

const FIXED_BASE =
  "POST&https%3A%2F%2F9394021-sb1.suitetalk.api.netsuite.com%2Fservices%2Frest%2Fquery%2Fv1%2Fsuiteql&limit%3D1000%26oauth_consumer_key%3Dck%26oauth_nonce%3Dn%26oauth_signature_method%3DHMAC-SHA256%26oauth_timestamp%3D1700000000%26oauth_token%3Dtk%26oauth_version%3D1.0%26offset%3D0";

const FIXED_SIGNATURE = "anD/M4M11mN+kVC27Gt7BI+DSweuXPckRexCLxX8a7w=";

describe("OAuth TBA HMAC-SHA256", () => {
  it("encode les caractères réservés RFC 3986 et laisse le tilde", () => {
    assert.equal(percentEncode("a b*!'()~"), "a%20b%2A%21%27%28%29~");
  });

  it("signe un vecteur fixe et inclut limit et offset", () => {
    const signed = buildAuthorization({
      method: "POST",
      url: FIXED_URL,
      consumerKey: "ck",
      consumerSecret: "cs",
      tokenId: "tk",
      tokenSecret: "ts",
      realm: "9394021_SB1",
      nonce: "n",
      timestamp: "1700000000",
    });

    assert.equal(signed.baseString, FIXED_BASE);
    assert.equal(signed.signature, FIXED_SIGNATURE);
    assert.match(signed.baseString, /limit%3D1000/);
    assert.match(signed.baseString, /offset%3D0/);
    assert.equal(signed.baseString.includes("9394021_SB1"), false);
    assert.match(signed.header, /realm="9394021_SB1"/);
    assert.match(signed.header, /oauth_signature_method="HMAC-SHA256"/);
    assert.match(
      signed.header,
      /oauth_signature="anD%2FM4M11mN%2BkVC27Gt7BI%2BDSweuXPckRexCLxX8a7w%3D"/,
    );
  });

  it("utilise la clé encode(secret) & encode(jeton)", () => {
    const base = signatureBaseString(
      "GET",
      "https://exemple.invalid/a",
      "oauth_consumer_key=ck",
    );
    const plain = buildAuthorization({
      method: "GET",
      url: "https://exemple.invalid/a",
      consumerKey: "ck",
      consumerSecret: "cs",
      tokenId: "tk",
      tokenSecret: "ts",
      realm: "9394021_SB1",
      nonce: "n",
      timestamp: "1700000000",
    });
    const encoded = buildAuthorization({
      method: "GET",
      url: "https://exemple.invalid/a",
      consumerKey: "ck",
      consumerSecret: "c s",
      tokenId: "tk",
      tokenSecret: "t&s",
      realm: "9394021_SB1",
      nonce: "n",
      timestamp: "1700000000",
    });
    assert.notEqual(plain.signature, encoded.signature);
    assert.match(base, /^GET&/);
  });

  it("transforme le compte sandbox en hôte SuiteTalk", () => {
    assert.equal(
      netsuiteRestHost("9394021_SB1"),
      "https://9394021-sb1.suitetalk.api.netsuite.com",
    );
  });
});
