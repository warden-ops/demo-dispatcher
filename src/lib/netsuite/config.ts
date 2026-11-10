export type EnvMap = Record<string, string | undefined>;

const REQUIRED_ENV = [
  "NETSUITE_ACCOUNT_ID",
  "NETSUITE_CONSUMER_KEY",
  "NETSUITE_CONSUMER_SECRET",
  "NETSUITE_TOKEN_ID",
  "NETSUITE_TOKEN_SECRET",
] as const;

export type NetsuiteCredentials = {
  accountId: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
};

export function readEnvValue(
  env: EnvMap,
  key: string,
): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Vrai seulement si les cinq variables TBA sont présentes. */
export function isNetsuiteConfigured(
  env: EnvMap = process.env,
): boolean {
  return REQUIRED_ENV.every((key) => readEnvValue(env, key).length > 0);
}

/** Faux par défaut. Seule la valeur exacte "true" ouvre l'écriture. */
export function isNetsuiteWriteEnabled(
  env: EnvMap = process.env,
): boolean {
  return readEnvValue(env, "NETSUITE_WRITE_ENABLED") === "true";
}

export function readNetsuiteCredentials(
  env: EnvMap = process.env,
): NetsuiteCredentials {
  const accountId = readEnvValue(env, "NETSUITE_ACCOUNT_ID");
  if (!/^[A-Za-z0-9_]+$/.test(accountId)) {
    throw new Error("NETSUITE_ACCOUNT_ID est absent ou invalide.");
  }
  const credentials: NetsuiteCredentials = {
    accountId,
    consumerKey: readEnvValue(env, "NETSUITE_CONSUMER_KEY"),
    consumerSecret: readEnvValue(env, "NETSUITE_CONSUMER_SECRET"),
    tokenId: readEnvValue(env, "NETSUITE_TOKEN_ID"),
    tokenSecret: readEnvValue(env, "NETSUITE_TOKEN_SECRET"),
  };
  if (
    !credentials.consumerKey ||
    !credentials.consumerSecret ||
    !credentials.tokenId ||
    !credentials.tokenSecret
  ) {
    throw new Error("Identifiants TBA NetSuite incomplets.");
  }
  return credentials;
}

/**
 * Hôte REST SuiteTalk. Le compte 9394021_SB1 devient
 * https://9394021-sb1.suitetalk.api.netsuite.com
 */
export function netsuiteRestHost(accountId: string): string {
  const slug = accountId.trim().toLowerCase().replace(/_/g, "-");
  return `https://${slug}.suitetalk.api.netsuite.com`;
}

export function credentialSecrets(credentials: NetsuiteCredentials): string[] {
  return [
    credentials.consumerKey,
    credentials.consumerSecret,
    credentials.tokenId,
    credentials.tokenSecret,
  ];
}
