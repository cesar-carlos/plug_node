import {
  addBusinessDays as addBusinessDaysFns,
  format as formatDateFns,
  parseISO,
} from "date-fns";

import { PlugValidationError } from "../contracts/errors";

const toDate = (value: unknown): Date => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = parseISO(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
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

export const formatDateValue = (value: unknown, pattern: unknown): string => {
  const date = toDate(value);
  const formatPattern = typeof pattern === "string" && pattern.trim() ? pattern : "iso";
  return formatPattern === "iso"
    ? date.toISOString()
    : formatDateFns(date, formatPattern);
};

export const parseDateValue = (value: unknown): { iso: string; timestampMs: number } => {
  const date = toDate(value);
  return {
    iso: date.toISOString(),
    timestampMs: date.valueOf(),
  };
};

export const addBusinessDaysValue = (value: unknown, amount: unknown): string =>
  addBusinessDaysFns(
    toDate(value),
    Math.trunc(toNumber(amount, "Business Days")),
  ).toISOString();

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
