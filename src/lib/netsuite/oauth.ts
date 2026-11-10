import { createHmac, randomBytes } from "node:crypto";

export type OAuthPair = [string, string];

export type OAuthHeaderInput = {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
  realm: string;
  nonce: string;
  timestamp: string;
};

export type OAuthHeader = {
  header: string;
  baseString: string;
  signature: string;
};

/** Encodage RFC 3986 : les caractères ! ' ( ) * sont aussi échappés. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function randomNonce(): string {
  return randomBytes(16).toString("hex");
}

export function unixTimestamp(now = Date.now()): string {
  return String(Math.floor(now / 1000));
}

export function splitRequestUrl(rawUrl: string): {
  baseUrl: string;
  query: OAuthPair[];
} {
  const url = new URL(rawUrl);
  const query: OAuthPair[] = [];
  url.searchParams.forEach((value, key) => {
    query.push([key, value]);
  });
  return { baseUrl: `${url.origin}${url.pathname}`, query };
}

export function normalizeParams(params: OAuthPair[]): string {
  return params
    .map(([key, value]) => [percentEncode(key), percentEncode(value)] as const)
    .sort((left, right) => {
      if (left[0] === right[0]) {
        if (left[1] === right[1]) return 0;
        return left[1] < right[1] ? -1 : 1;
      }
      return left[0] < right[0] ? -1 : 1;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export function signatureBaseString(
  method: string,
  baseUrl: string,
  normalizedParams: string,
): string {
  return [
    percentEncode(method.toUpperCase()),
    percentEncode(baseUrl),
    percentEncode(normalizedParams),
  ].join("&");
}

export function signBaseString(
  baseString: string,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac("sha256", key).update(baseString).digest("base64");
}

/**
 * OAuth 1.0a TBA HMAC-SHA256.
 * Le realm va dans l'en-tête seulement. Les paramètres de query
 * (limit, offset) entrent dans la base string.
 */
export function buildAuthorization(input: OAuthHeaderInput): OAuthHeader {
  const { baseUrl, query } = splitRequestUrl(input.url);
  const oauthParams: OAuthPair[] = [
    ["oauth_consumer_key", input.consumerKey],
    ["oauth_nonce", input.nonce],
    ["oauth_signature_method", "HMAC-SHA256"],
    ["oauth_timestamp", input.timestamp],
    ["oauth_token", input.tokenId],
    ["oauth_version", "1.0"],
  ];
  const normalized = normalizeParams([...query, ...oauthParams]);
  const baseString = signatureBaseString(input.method, baseUrl, normalized);
  const signature = signBaseString(
    baseString,
    input.consumerSecret,
    input.tokenSecret,
  );
  const headerParams: OAuthPair[] = [
    ["realm", input.realm],
    ...oauthParams,
    ["oauth_signature", signature],
  ];
  const header = `OAuth ${headerParams
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(",")}`;
  return { header, baseString, signature };
}
