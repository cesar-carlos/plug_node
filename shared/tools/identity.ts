import { randomUUID } from "node:crypto";

import { PlugValidationError } from "../contracts/errors";

export type BrazilianDocumentType = "cpf" | "cnpj" | "unknown";

export interface BrazilianDocumentValidation {
  readonly value: string;
  readonly digits: string;
  readonly type: BrazilianDocumentType;
  readonly valid: boolean;
}

const onlyDigits = (value: string): string => value.replace(/\D/gu, "");

const hasRepeatedDigits = (digits: string): boolean => /^(\d)\1+$/u.test(digits);

const checkCpf = (digits: string): boolean => {
  if (digits.length !== 11 || hasRepeatedDigits(digits)) {
    return false;
  }

  const calculate = (length: number): number => {
    const sum = digits
      .slice(0, length)
      .split("")
      .reduce((acc, digit, index) => acc + Number(digit) * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return calculate(9) === Number(digits[9]) && calculate(10) === Number(digits[10]);
};

const checkCnpj = (digits: string): boolean => {
  if (digits.length !== 14 || hasRepeatedDigits(digits)) {
    return false;
  }

  const weights = [
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  ];

  const calculate = (length: number, weightIndex: number): number => {
    const sum = digits
      .slice(0, length)
      .split("")
      .reduce(
        (acc, digit, index) => acc + Number(digit) * weights[weightIndex][index],
        0,
      );
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return (
    calculate(12, 0) === Number(digits[12]) && calculate(13, 1) === Number(digits[13])
  );
};

export const validateBrazilianDocument = (
  value: unknown,
): BrazilianDocumentValidation => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PlugValidationError("Document must be a non-empty string");
  }

  const digits = onlyDigits(value);
  if (digits.length === 11) {
    return {
      value,
      digits,
      type: "cpf",
      valid: checkCpf(digits),
    };
  }

  if (digits.length === 14) {
    return {
      value,
      digits,
      type: "cnpj",
      valid: checkCnpj(digits),
    };
  }

  return {
    value,
    digits,
    type: "unknown",
    valid: false,
  };
};

export const formatBrazilianDocument = (value: unknown): string => {
  const validation = validateBrazilianDocument(value);
  if (validation.type === "cpf" && validation.valid) {
    return validation.digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/u, "$1.$2.$3-$4");
  }

  if (validation.type === "cnpj" && validation.valid) {
    return validation.digits.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/u,
      "$1.$2.$3/$4-$5",
    );
  }

  throw new PlugValidationError("Document must be a valid CPF or CNPJ");
};

export const generateUuid = (): string => randomUUID();
