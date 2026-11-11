import { REGIONS } from "../guertech/constants";

const PROVINCE_CODES = new Set([
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
]);

const PROVINCE_NAMES: Record<string, string> = {
  alberta: "AB",
  "british columbia": "BC",
  "colombie-britannique": "BC",
  "colombie britannique": "BC",
  manitoba: "MB",
  "new brunswick": "NB",
  "nouveau-brunswick": "NB",
  "nouveau brunswick": "NB",
  "newfoundland and labrador": "NL",
  "newfoundland": "NL",
  "terre-neuve-et-labrador": "NL",
  "terre neuve et labrador": "NL",
  "nova scotia": "NS",
  "nouvelle-ecosse": "NS",
  "nouvelle ecosse": "NS",
  "northwest territories": "NT",
  "territoires du nord-ouest": "NT",
  nunavut: "NU",
  ontario: "ON",
  "prince edward island": "PE",
  "ile-du-prince-edouard": "PE",
  quebec: "QC",
  saskatchewan: "SK",
  yukon: "YT",
};

const PROVINCE_LABELS: Record<string, string> = {
  AB: "Alberta",
  BC: "Colombie-Britannique",
  MB: "Manitoba",
  NB: "Nouveau-Brunswick",
  NL: "Terre-Neuve-et-Labrador",
  NS: "Nouvelle-Écosse",
  NT: "Territoires du Nord-Ouest",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Île-du-Prince-Édouard",
  QC: "Québec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

/**
 * Villes du territoire des techniciens de démo. Les libellés sont exactement
 * ceux de REGIONS, pour que l'appel et le technicien se comparent.
 */
const CITY_REGION: Record<string, string> = {
  becancour: "Centre-du-Québec",
  drummondville: "Centre-du-Québec",
  nicolet: "Centre-du-Québec",
  plessisville: "Centre-du-Québec",
  princeville: "Centre-du-Québec",
  victoriaville: "Centre-du-Québec",
  "la tuque": "Mauricie",
  shawinigan: "Mauricie",
  "trois-rivieres": "Mauricie",
  "trois rivieres": "Mauricie",
  asbestos: "Estrie",
  "val-des-sources": "Estrie",
  "val des sources": "Estrie",
  coaticook: "Estrie",
  granby: "Estrie",
  magog: "Estrie",
  sherbrooke: "Estrie",
  windsor: "Estrie",
  levis: "Chaudière-Appalaches",
  montmagny: "Chaudière-Appalaches",
  "saint-georges": "Chaudière-Appalaches",
  "sainte-marie": "Chaudière-Appalaches",
  "thetford mines": "Chaudière-Appalaches",
  "thetford-mines": "Chaudière-Appalaches",
  brossard: "Montérégie",
  chambly: "Montérégie",
  longueuil: "Montérégie",
  "saint-hyacinthe": "Montérégie",
  "saint-jean-sur-richelieu": "Montérégie",
  "salaberry-de-valleyfield": "Montérégie",
  "sorel-tracy": "Montérégie",
  "vaudreuil-dorion": "Montérégie",
  montreal: "Montréal",
  toronto: "Toronto",
  "sault sainte marie": "Nord de l'Ontario — P6",
  "sept-iles": "Côte-Nord",
  "sept iles": "Côte-Nord",
  wawa: "Nord de l'Ontario — P0",
  tillsonburg: "Sud-ouest de l'Ontario — N4",
  "corner brook": "Terre-Neuve-et-Labrador",
};

/**
 * Affichage des villes connues. « Sept-Iles » et « SEPT-ILES » deviennent
 * « Sept-Îles ». Une ville inconnue garde le texte, sans accent inventé.
 */
const CANONICAL_PLACE: Record<string, string> = {
  becancour: "Bécancour",
  montreal: "Montréal",
  "trois rivieres": "Trois-Rivières",
  "sept iles": "Sept-Îles",
  "val des sources": "Val-des-Sources",
};

/** FSA (3 caractères) dont la région technicien est sûre. */
const FSA_REGION: Record<string, string> = {
  J2B: "Centre-du-Québec",
  J2C: "Centre-du-Québec",
  G6P: "Centre-du-Québec",
  G6R: "Centre-du-Québec",
  G6S: "Centre-du-Québec",
  G6T: "Centre-du-Québec",
  G6L: "Centre-du-Québec",
  G9H: "Centre-du-Québec",
  J3T: "Centre-du-Québec",
  G8T: "Mauricie",
  G8V: "Mauricie",
  G8W: "Mauricie",
  G8Y: "Mauricie",
  G8Z: "Mauricie",
  G9A: "Mauricie",
  G9B: "Mauricie",
  G9C: "Mauricie",
  G9N: "Mauricie",
  G9P: "Mauricie",
  G9R: "Mauricie",
  G9T: "Mauricie",
  G9X: "Mauricie",
  J1A: "Estrie",
  J1C: "Estrie",
  J1E: "Estrie",
  J1G: "Estrie",
  J1H: "Estrie",
  J1J: "Estrie",
  J1K: "Estrie",
  J1L: "Estrie",
  J1M: "Estrie",
  J1N: "Estrie",
  J1R: "Estrie",
  J1S: "Estrie",
  J1T: "Estrie",
  J1X: "Estrie",
  J2G: "Estrie",
  J2H: "Estrie",
  J2J: "Estrie",
  G5V: "Chaudière-Appalaches",
  G5Y: "Chaudière-Appalaches",
  G5Z: "Chaudière-Appalaches",
  G6A: "Chaudière-Appalaches",
  G6E: "Chaudière-Appalaches",
  G6G: "Chaudière-Appalaches",
  G6H: "Chaudière-Appalaches",
  G6V: "Chaudière-Appalaches",
  G6W: "Chaudière-Appalaches",
  G6X: "Chaudière-Appalaches",
  G6Y: "Chaudière-Appalaches",
  G6Z: "Chaudière-Appalaches",
  G7A: "Chaudière-Appalaches",
  J2R: "Montérégie",
  J2S: "Montérégie",
  J2T: "Montérégie",
  J2W: "Montérégie",
  J2X: "Montérégie",
  J3A: "Montérégie",
  J3B: "Montérégie",
  J3L: "Montérégie",
  J3P: "Montérégie",
  J3R: "Montérégie",
  J6S: "Montérégie",
  J6T: "Montérégie",
  J7V: "Montérégie",
};

const POSTAL_PATTERN = /\b([A-Za-z]\d[A-Za-z])\s?(\d[A-Za-z]\d)\b/;

export type ParsedAddress = {
  ville: string;
  province: string;
  postal: string;
};

const EMPTY_ADDRESS: ParsedAddress = { ville: "", province: "", postal: "" };

export function normalizeLookup(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function foldPlace(value: string): string {
  return normalizeLookup(value).replace(/-/g, " ");
}

export function normalizePostal(value: string): string {
  const match = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .match(/^([A-Z]\d[A-Z])(\d[A-Z]\d)/);
  if (!match) return "";
  return `${match[1]} ${match[2]}`;
}

export function normalizeProvince(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const compact = trimmed.replace(/\./g, "").toUpperCase();
  if (PROVINCE_CODES.has(compact)) return compact;
  return PROVINCE_NAMES[foldPlace(trimmed)] ?? "";
}

function canonicalPlace(value: string): string {
  const spaced = foldPlace(value)
    .replace(/\./g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return CANONICAL_PLACE[spaced] ?? "";
}

/** Enlève la ponctuation finale (« Tillsonburg. ») sans toucher à « Ste. ». */
function cleanCityToken(token: string): string {
  if (/^(st|ste)\.?$/i.test(token)) return token;
  return token.replace(/^[.,;:]+|[.,;:]+$/g, "");
}

export function formatPlaceName(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const known = canonicalPlace(trimmed);
  if (known) return known;
  const letters = trimmed.replace(/[^\p{L}]/gu, "");
  if (!letters || letters !== letters.toUpperCase()) return trimmed;
  const titled = trimmed.toLowerCase().replace(
    /(^|[\s\-'/])(\p{L})/gu,
    (_match, sep: string, char: string) => sep + char.toUpperCase(),
  );
  return canonicalPlace(titled) || titled;
}

function extractPostal(text: string): string {
  const match = POSTAL_PATTERN.exec(text);
  if (!match) return "";
  return `${match[1].toUpperCase()} ${match[2].toUpperCase()}`;
}

function provinceFromTokens(tokens: string[]): {
  province: string;
  consumed: number;
} {
  if (tokens.length === 0) return { province: "", consumed: 0 };
  const last = tokens[tokens.length - 1].replace(/\./g, "").toUpperCase();
  if (PROVINCE_CODES.has(last)) return { province: last, consumed: 1 };
  for (const size of [3, 2, 1]) {
    if (tokens.length < size) continue;
    const code = PROVINCE_NAMES[foldPlace(tokens.slice(-size).join(" "))];
    if (code) return { province: code, consumed: size };
  }
  return { province: "", consumed: 0 };
}

function splitCityProvince(text: string): { ville: string; province: string } {
  const cleaned = text.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return { ville: "", province: "" };
  const tokens = cleaned.split(" ").filter(Boolean);
  const found = provinceFromTokens(tokens);
  const cityTokens = (found.consumed > 0
    ? tokens.slice(0, -found.consumed)
    : tokens
  )
    .map(cleanCityToken)
    .filter(Boolean);
  return {
    ville: formatPlaceName(cityTokens.join(" ")),
    province: found.province,
  };
}

function cityFromCommaParts(parts: string[]): {
  ville: string;
  province: string;
} {
  const segments = [...parts];
  while (segments.length > 0 && /^(canada|ca)$/i.test(segments[segments.length - 1])) {
    segments.pop();
  }
  if (segments.length === 0) return { ville: "", province: "" };

  const last = segments[segments.length - 1].replace(POSTAL_PATTERN, " ").trim();
  const lastSplit = splitCityProvince(last);
  const lastIsProvinceOnly = Boolean(lastSplit.province) && !lastSplit.ville;
  if (lastIsProvinceOnly && segments.length >= 2) {
    const city = splitCityProvince(segments[segments.length - 2]);
    return {
      ville: city.ville,
      province: lastSplit.province || city.province,
    };
  }
  if (lastSplit.ville) {
    return lastSplit;
  }
  if (segments.length >= 2) {
    return splitCityProvince(segments[segments.length - 2]);
  }
  return { ville: "", province: "" };
}

function addressLines(address: string): string[] {
  return address
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(canada|ca)$/i.test(line));
}

function parsePostalLine(
  line: string,
  previous: string | undefined,
): ParsedAddress | null {
  const postal = extractPostal(line);
  if (!postal) return null;
  const remainder = line.replace(POSTAL_PATTERN, " ").replace(/\s+/g, " ").trim();
  if (!remainder.replace(/,/g, "").trim()) {
    const city = splitCityProvince(previous ?? "");
    if (!city.ville) return null;
    return { ...city, postal };
  }
  if (remainder.includes(",")) {
    const city = cityFromCommaParts(remainder.split(",").map((part) => part.trim()));
    if (!city.ville) return null;
    return { ...city, postal };
  }
  const city = splitCityProvince(remainder);
  if (!city.ville) return null;
  return { ...city, postal };
}

/**
 * Ville, province et code postal d'une adresse canadienne.
 * Accepte la ligne unique « rue, ville, QC H1H 1H1 » et le bloc NetSuite
 * « RUE\\r\\nVILLE PROV POSTAL ».
 */
export function parseAddressText(address: string): ParsedAddress {
  const lines = addressLines(address);
  if (lines.length === 0) return EMPTY_ADDRESS;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parsePostalLine(lines[index], lines[index - 1]);
    if (parsed?.ville) return parsed;
  }

  if (address.includes(",")) {
    const flat = address.replace(/\r\n|\n|\r/g, ", ");
    const parts = flat
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const city = cityFromCommaParts(parts);
    if (city.ville) {
      return { ...city, postal: extractPostal(flat) };
    }
  }

  const last = lines[lines.length - 1];
  const fromLast = splitCityProvince(last);
  const previous = lines[lines.length - 2] ?? "";
  const lastHasStreetNumber = /\d/.test(last);
  if (fromLast.province && fromLast.ville) return { ...fromLast, postal: "" };
  if (
    !lastHasStreetNumber &&
    fromLast.ville &&
    (lines.length > 1 || !/\d/.test(previous))
  ) {
    if (lines.length === 1 && /\d/.test(lines[0])) return EMPTY_ADDRESS;
    return { ville: fromLast.ville, province: fromLast.province, postal: "" };
  }
  return EMPTY_ADDRESS;
}

export function villeFromAddress(address: string): string {
  return parseAddressText(address).ville;
}

function regionFromCityKey(ville: string): string {
  const folded = foldPlace(ville)
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bste\b/g, "sainte")
    .replace(/\bst\b/g, "saint");
  if (!folded) return "";
  const hyphenated = folded.replace(/ /g, "-");
  return (
    CITY_REGION[folded] ??
    CITY_REGION[hyphenated] ??
    CITY_REGION[normalizeLookup(ville)] ??
    ""
  );
}

function regionFromFsa(postal: string): string {
  const fsa = postal.slice(0, 3);
  if (!/^[A-Z]\d[A-Z]$/.test(fsa)) return "";
  if (FSA_REGION[fsa]) return FSA_REGION[fsa];
  if (fsa.startsWith("J4")) return "Montérégie";
  const prefix = fsa.slice(0, 2);
  switch (fsa[0]) {
    case "H":
      return "Montréal";
    case "M":
      return "Toronto";
    case "K":
      return `Est de l'Ontario — ${prefix}`;
    case "L":
      return `Centre de l'Ontario — ${prefix}`;
    case "N":
      return `Sud-ouest de l'Ontario — ${prefix}`;
    case "P":
      return `Nord de l'Ontario — ${prefix}`;
    case "G":
    case "J":
      return `Québec — ${prefix}`;
    case "A":
      return "Terre-Neuve-et-Labrador";
    case "B":
      return "Nouvelle-Écosse";
    case "C":
      return "Île-du-Prince-Édouard";
    case "E":
      return "Nouveau-Brunswick";
    case "R":
      return "Manitoba";
    case "S":
      return "Saskatchewan";
    case "T":
      return `Alberta — ${prefix}`;
    case "V":
      return `Colombie-Britannique — ${prefix}`;
    case "X":
      return "Territoires du Nord";
    case "Y":
      return "Yukon";
    default:
      return "";
  }
}

function regionFromKnownLabel(value: string): string {
  const folded = foldPlace(value);
  if (!folded) return "";
  return REGIONS.find((region) => foldPlace(region) === folded) ?? "";
}

/**
 * Même fonction pour un appel et un technicien.
 * Priorité : libellé de région déjà connu, ville du territoire, FSA, province.
 */
export function deriveRegion(input: {
  ville?: string;
  province?: string;
  postal?: string;
  /** Lieu ou zone déjà portée par NetSuite (location, ville, libellé). */
  explicit?: string;
}): string {
  const explicit = (input.explicit ?? "").trim();
  const knownExplicit = regionFromKnownLabel(explicit);
  if (knownExplicit) return knownExplicit;

  const postal = normalizePostal(input.postal ?? "") || normalizePostal(explicit);
  const fromFsa = regionFromFsa(postal);
  const postalOutsideQuebec =
    postal.length >= 3 && !["G", "H", "J"].includes(postal[0]);

  const fromCity = regionFromCityKey(input.ville ?? "");
  if (fromCity) {
    if (postalOutsideQuebec && fromFsa && fromFsa !== fromCity) return fromFsa;
    return fromCity;
  }

  const fromExplicitCity = regionFromCityKey(explicit);
  if (fromExplicitCity) {
    if (postalOutsideQuebec && fromFsa && fromFsa !== fromExplicitCity) {
      return fromFsa;
    }
    return fromExplicitCity;
  }

  if (fromFsa) return fromFsa;

  const province =
    normalizeProvince(input.province ?? "") || normalizeProvince(explicit);
  if (province) return PROVINCE_LABELS[province] ?? "";
  return "";
}
