import "server-only";

import {
  credentialSecrets,
  netsuiteRestHost,
  readNetsuiteCredentials,
  type EnvMap,
  type NetsuiteCredentials,
} from "./config";
import { buildAuthorization, randomNonce, unixTimestamp } from "./oauth";

const SUITEQL_PAGE_LIMIT = 1000;
const MAX_SUITEQL_PAGES = 25;

export type SuiteQlPage = {
  items: Record<string, unknown>[];
  hasMore: boolean;
  count: number;
  offset: number;
  totalResults: number | null;
};

export type NetsuiteClient = {
  suiteql: (
    query: string,
    options?: { limit?: number; offset?: number },
  ) => Promise<SuiteQlPage>;
  suiteqlAll: (query: string) => Promise<Record<string, unknown>[]>;
  patchRecord: (
    type: string,
    id: string,
    body: Record<string, unknown>,
  ) => Promise<void>;
};

export type NetsuiteClientOptions = {
  env?: EnvMap;
  fetchImpl?: typeof fetch;
  nonce?: () => string;
  timestamp?: () => string;
  credentials?: NetsuiteCredentials;
};

export class NetsuiteError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "NetsuiteError";
    this.status = status;
  }
}

export function redactSecrets(message: string, secrets: string[]): string {
  let output = message;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    output = output.split(secret).join("[secret]");
  }
  return output;
}

function assertRecordPath(type: string, id: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(type) || !/^\d+$/.test(id)) {
    throw new NetsuiteError("Type ou identifiant d'enregistrement invalide.", 400);
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return "";
    const parsed = JSON.parse(text) as {
      title?: string;
      detail?: string;
      "o:errorDetails"?: { detail?: string }[];
    };
    return (
      parsed["o:errorDetails"]?.[0]?.detail ||
      parsed.detail ||
      parsed.title ||
      ""
    )
      .replace(/\s+/g, " ")
      .slice(0, 300);
  } catch {
    return "";
  }
}

export function createNetsuiteClient(
  options: NetsuiteClientOptions = {},
): NetsuiteClient {
  const env = options.env ?? process.env;
  const credentials = options.credentials ?? readNetsuiteCredentials(env);
  const fetchImpl = options.fetchImpl ?? fetch;
  const host = netsuiteRestHost(credentials.accountId);
  const secrets = credentialSecrets(credentials);

  async function authorizedFetch(
    method: string,
    url: string,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    const authorization = buildAuthorization({
      method,
      url,
      consumerKey: credentials.consumerKey,
      consumerSecret: credentials.consumerSecret,
      tokenId: credentials.tokenId,
      tokenSecret: credentials.tokenSecret,
      realm: credentials.accountId,
      nonce: (options.nonce ?? randomNonce)(),
      timestamp: (options.timestamp ?? unixTimestamp)(),
    });
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: authorization.header,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new NetsuiteError("Impossible de joindre NetSuite.", 502);
    }
    if (!response.ok) {
      const detail = redactSecrets(await readErrorDetail(response), secrets);
      throw new NetsuiteError(
        `NetSuite a répondu ${response.status}${detail ? ` : ${detail}` : "."}`,
        response.status,
      );
    }
    return response;
  }

  async function suiteql(
    query: string,
    page: { limit?: number; offset?: number } = {},
  ): Promise<SuiteQlPage> {
    const limit = page.limit ?? SUITEQL_PAGE_LIMIT;
    const offset = page.offset ?? 0;
    const url = new URL(`${host}/services/rest/query/v1/suiteql`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const response = await authorizedFetch(
      "POST",
      url.toString(),
      { q: query },
      { Prefer: "transient" },
    );
    const payload = (await response.json()) as {
      items?: Record<string, unknown>[];
      hasMore?: boolean;
      count?: number;
      offset?: number;
      totalResults?: number;
    };
    const items = Array.isArray(payload.items) ? payload.items : [];
    return {
      items,
      hasMore: payload.hasMore === true,
      count: Number(payload.count ?? items.length) || items.length,
      offset: Number(payload.offset ?? offset) || offset,
      totalResults:
        payload.totalResults == null ? null : Number(payload.totalResults),
    };
  }

  async function suiteqlAll(
    query: string,
  ): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_SUITEQL_PAGES; page += 1) {
      const result = await suiteql(query, {
        limit: SUITEQL_PAGE_LIMIT,
        offset,
      });
      items.push(...result.items);
      if (!result.hasMore) return items;
      offset += result.count > 0 ? result.count : SUITEQL_PAGE_LIMIT;
    }
    return items;
  }

  async function patchRecord(
    type: string,
    id: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    assertRecordPath(type, id);
    const url = `${host}/services/rest/record/v1/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
    await authorizedFetch("PATCH", url, body);
  }

  return { suiteql, suiteqlAll, patchRecord };
}
