const US_STATE_NAMES_BY_CODE = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
} as const;

const US_STATE_CODES = Object.keys(US_STATE_NAMES_BY_CODE) as Array<keyof typeof US_STATE_NAMES_BY_CODE>;
const US_STATE_CODE_SET = new Set<string>(US_STATE_CODES);
const US_STATE_CODE_BY_NORMALIZED_NAME = Object.fromEntries(
  Object.entries(US_STATE_NAMES_BY_CODE).map(([code, name]) => [normalizeAddressToken(name), code])
) as Record<string, string>;
const STATE_SUFFIX_CANDIDATES = [
  ...US_STATE_CODES.map((code) => ({ raw: code, normalized: normalizeAddressToken(code) })),
  ...Object.entries(US_STATE_NAMES_BY_CODE).map(([code, name]) => ({ raw: name, normalized: normalizeAddressToken(name), code })),
].sort((a, b) => b.normalized.length - a.normalized.length);

export type UsAddressMissingField = "street" | "city" | "state" | "zipCode";

export interface UsAddressParts {
  street: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface ParsedUsAddress extends UsAddressParts {
  isComplete: boolean;
  missingFields: UsAddressMissingField[];
}

function normalizeWhitespace(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeAddressToken(value: string) {
  return normalizeWhitespace(value)
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function stripTrailingUsCountry(value: string) {
  return normalizeWhitespace(value).replace(/(?:,\s*|\s+)(?:USA|US|United States(?: of America)?)\.?$/i, "").trim();
}

export function normalizeUsState(value: string): string {
  const trimmed = normalizeWhitespace(value).replace(/[.,]/g, "");
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (US_STATE_CODE_SET.has(upper)) return upper;
  return US_STATE_CODE_BY_NORMALIZED_NAME[normalizeAddressToken(trimmed)] || "";
}

function splitCityAndState(value: string): { city: string; state: string } {
  const trimmed = normalizeWhitespace(value).replace(/,$/, "");
  if (!trimmed) return { city: "", state: "" };
  const normalized = normalizeAddressToken(trimmed);
  for (const candidate of STATE_SUFFIX_CANDIDATES) {
    if (normalized === candidate.normalized || normalized.endsWith(` ${candidate.normalized}`)) {
      const suffixPattern = new RegExp(`${escapeRegex(candidate.raw)}$`, "i");
      const city = normalizeWhitespace(trimmed.replace(suffixPattern, "").replace(/[\s,]+$/, ""));
      const state = normalizeUsState(candidate.raw);
      if (state) return { city, state };
    }
  }
  return { city: trimmed, state: "" };
}

export function formatUsAddress(parts: Partial<UsAddressParts>): string {
  const street = normalizeWhitespace(parts.street || "");
  const city = normalizeWhitespace(parts.city || "");
  const state = normalizeUsState(parts.state || "");
  const zipCode = normalizeWhitespace(parts.zipCode || "");
  return [street, city, [state, zipCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function parseUsAddress(input: string): ParsedUsAddress {
  const raw = stripTrailingUsCountry(input);
  if (!raw) {
    return { street: "", city: "", state: "", zipCode: "", isComplete: false, missingFields: ["street", "city", "state", "zipCode"] };
  }

  const zipMatch = raw.match(/(\d{5}(?:-\d{4})?)\s*$/);
  const zipCode = zipMatch?.[1] || "";
  const withoutZip = normalizeWhitespace(zipCode ? raw.slice(0, raw.length - zipMatch![0].length) : raw).replace(/[.,\s]+$/, "");
  const parts = withoutZip.split(",").map((part) => normalizeWhitespace(part)).filter(Boolean);

  let street = "";
  let city = "";
  let state = "";

  if (parts.length >= 3) {
    street = parts.slice(0, -2).join(", ") || parts[0] || "";
    city = parts.at(-2) || "";
    state = normalizeUsState(parts.at(-1) || "");
    if (!state) {
      const split = splitCityAndState([city, parts.at(-1) || ""].filter(Boolean).join(" "));
      city = split.city;
      state = split.state;
    }
  } else if (parts.length === 2) {
    street = parts[0] || "";
    const split = splitCityAndState(parts[1] || "");
    city = split.city;
    state = split.state;
  } else if (parts.length === 1) {
    street = parts[0] || "";
  }

  const missingFields: UsAddressMissingField[] = [];
  if (!street) missingFields.push("street");
  if (!city) missingFields.push("city");
  if (!state) missingFields.push("state");
  if (!zipCode) missingFields.push("zipCode");

  return {
    street,
    city,
    state,
    zipCode,
    isComplete: missingFields.length === 0,
    missingFields,
  };
}

export function buildMissingAddressMessage(missingFields: UsAddressMissingField[]): string {
  const labels = Array.from(new Set(missingFields)).map((field) => {
    switch (field) {
      case "street":
        return "street";
      case "city":
        return "city";
      case "state":
        return "state";
      case "zipCode":
        return "ZIP";
    }
  });

  return labels.length
    ? `Địa chỉ chưa đủ thông tin. Vui lòng bổ sung ${labels.join("/")}.`
    : "Địa chỉ chưa đủ thông tin. Vui lòng bổ sung street/city/state/ZIP.";
}

function escapeRegex(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export { US_STATE_NAMES_BY_CODE };
