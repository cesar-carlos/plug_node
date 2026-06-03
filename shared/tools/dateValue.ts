import { PlugValidationError } from "../contracts/errors";

const ISO_DATE_PREFIX =
  /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const parseIsoLikeDate = (value: string): Date | undefined => {
  const trimmed = value.trim();
  if (!ISO_DATE_PREFIX.test(trimmed)) {
    return undefined;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
};

const toDate = (value: unknown): Date => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const isoParsed = parseIsoLikeDate(value);
    if (isoParsed) {
      return isoParsed;
    }

    const fallback = new Date(value);
    if (!Number.isNaN(fallback.valueOf())) {
      return fallback;
    }
  }

  throw new PlugValidationError(
    "Date must be a valid ISO date, timestamp, or date string",
  );
};

const toNumber = (value: unknown, label: string): number => {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new PlugValidationError(`${label} must be a number`);
  }

  return numberValue;
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

const formatWithPattern = (date: Date, pattern: string): string => {
  const replacements: Array<{ readonly token: string; readonly value: string }> = [
    { token: "yyyy", value: String(date.getUTCFullYear()) },
    { token: "yy", value: String(date.getUTCFullYear()).slice(-2) },
    { token: "MM", value: pad2(date.getUTCMonth() + 1) },
    { token: "M", value: String(date.getUTCMonth() + 1) },
    { token: "dd", value: pad2(date.getUTCDate()) },
    { token: "d", value: String(date.getUTCDate()) },
    { token: "HH", value: pad2(date.getUTCHours()) },
    { token: "H", value: String(date.getUTCHours()) },
    { token: "mm", value: pad2(date.getUTCMinutes()) },
    { token: "m", value: String(date.getUTCMinutes()) },
    { token: "ss", value: pad2(date.getUTCSeconds()) },
    { token: "s", value: String(date.getUTCSeconds()) },
  ];

  let formatted = pattern;
  for (const { token, value } of replacements) {
    formatted = formatted.split(token).join(value);
  }

  return formatted;
};

const addBusinessDays = (date: Date, amount: number): Date => {
  const normalizedAmount = Math.trunc(amount);
  if (normalizedAmount === 0) {
    return new Date(date);
  }

  const result = new Date(date);
  const direction = normalizedAmount > 0 ? 1 : -1;
  let remaining = Math.abs(normalizedAmount);

  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + direction);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      remaining -= 1;
    }
  }

  return result;
};

export const formatDateValue = (value: unknown, pattern: unknown): string => {
  const date = toDate(value);
  const formatPattern = typeof pattern === "string" && pattern.trim() ? pattern : "iso";
  if (formatPattern === "iso") {
    return date.toISOString();
  }

  return formatWithPattern(date, formatPattern);
};

export const parseDateValue = (value: unknown): { iso: string; timestampMs: number } => {
  const date = toDate(value);
  return {
    iso: date.toISOString(),
    timestampMs: date.valueOf(),
  };
};

export const addBusinessDaysValue = (value: unknown, amount: unknown): string =>
  addBusinessDays(toDate(value), toNumber(amount, "Business Days")).toISOString();

export const formatCurrencyValue = (
  value: unknown,
  localeValue: unknown,
  currencyValue: unknown,
): string => {
  const locale =
    typeof localeValue === "string" && localeValue.trim() ? localeValue : "en-US";
  const currency =
    typeof currencyValue === "string" && currencyValue.trim() ? currencyValue : "USD";
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    toNumber(value, "Amount"),
  );
};

type ToWordsConstructor = new (options: { readonly localeCode: string }) => {
  convert(value: number): string;
};

const importPackage = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;

export const numberToWordsValue = async (
  value: unknown,
  localeValue: unknown,
): Promise<string> => {
  const localeCode =
    typeof localeValue === "string" && localeValue.trim() ? localeValue : "en-US";
  const imported = (await importPackage("to-words")) as {
    readonly ToWords: ToWordsConstructor;
  };
  const toWords = new imported.ToWords({ localeCode });
  return toWords.convert(toNumber(value, "Number"));
};
