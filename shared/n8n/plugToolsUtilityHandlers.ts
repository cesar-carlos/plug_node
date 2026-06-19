import { Buffer } from "node:buffer";

import type { IExecuteFunctions } from "n8n-workflow";

import { readBarcode } from "../tools/barcode";
import {
  csvToJson,
  extractRegexFields,
  jsonToCsv,
  normalizeText,
  transformJson,
  validateJsonSchema,
} from "../tools/data";
import {
  addBusinessDaysValue,
  formatCurrencyValue,
  formatDateValue,
  numberToWordsValue,
  parseDateValue,
} from "../tools/dateValue";
import {
  formatBrazilianDocument,
  generateUuid,
  validateBrazilianDocument,
} from "../tools/identity";
import {
  buildSocketEventPayload,
  buildSqlRequest,
  generateAccessRequestSummary,
  parseSqlRows,
  validateAgentContext,
  validateClientToken,
} from "../tools/plugSpecific";
import {
  base64DecodeToText,
  base64Encode,
  decodeJwtUnsafe,
  decryptText,
  encryptText,
  generateHash,
  hmacSign,
} from "../tools/security";
import { parseJsonText } from "../utils/json";
import {
  plugToolAddBusinessDaysOperation,
  plugToolBase64Operation,
  plugToolBuildSocketEventPayloadOperation,
  plugToolBuildSqlRequestOperation,
  plugToolCsvToJsonOperation,
  plugToolDecryptTextOperation,
  plugToolEncryptTextOperation,
  plugToolExtractRegexFieldsOperation,
  plugToolFormatCpfCnpjOperation,
  plugToolFormatCurrencyOperation,
  plugToolFormatDateOperation,
  plugToolGenerateAccessRequestSummaryOperation,
  plugToolGenerateHashOperation,
  plugToolGenerateUuidOperation,
  plugToolHmacSignOperation,
  plugToolJsonToCsvOperation,
  plugToolJwtDecodeOperation,
  plugToolNormalizeTextOperation,
  plugToolNumberToWordsOperation,
  plugToolParseDateOperation,
  plugToolParseSqlRowsOperation,
  plugToolReadBarcodeOperation,
  plugToolTransformJsonOperation,
  plugToolValidateAgentContextOperation,
  plugToolValidateClientTokenOperation,
  plugToolValidateCpfCnpjOperation,
  plugToolValidateJsonSchemaOperation,
} from "./plugToolsDescription";
import { assertBufferSize, normalizePositiveIntegerLimit } from "./plugToolsCommon";

export type UtilityOperation =
  | typeof plugToolReadBarcodeOperation
  | typeof plugToolValidateCpfCnpjOperation
  | typeof plugToolFormatCpfCnpjOperation
  | typeof plugToolGenerateUuidOperation
  | typeof plugToolTransformJsonOperation
  | typeof plugToolCsvToJsonOperation
  | typeof plugToolJsonToCsvOperation
  | typeof plugToolNormalizeTextOperation
  | typeof plugToolExtractRegexFieldsOperation
  | typeof plugToolValidateJsonSchemaOperation
  | typeof plugToolGenerateHashOperation
  | typeof plugToolHmacSignOperation
  | typeof plugToolBase64Operation
  | typeof plugToolJwtDecodeOperation
  | typeof plugToolEncryptTextOperation
  | typeof plugToolDecryptTextOperation
  | typeof plugToolFormatDateOperation
  | typeof plugToolParseDateOperation
  | typeof plugToolAddBusinessDaysOperation
  | typeof plugToolFormatCurrencyOperation
  | typeof plugToolNumberToWordsOperation
  | typeof plugToolBuildSocketEventPayloadOperation
  | typeof plugToolValidateClientTokenOperation
  | typeof plugToolValidateAgentContextOperation
  | typeof plugToolBuildSqlRequestOperation
  | typeof plugToolParseSqlRowsOperation
  | typeof plugToolGenerateAccessRequestSummaryOperation;

export type UtilityOperationHandler = (
  context: IExecuteFunctions,
  itemIndex: number,
) => Promise<unknown>;

const getJsonParameter = (
  context: IExecuteFunctions,
  name: string,
  itemIndex: number,
  fallback: string,
): unknown => {
  const value = context.getNodeParameter(name, itemIndex, fallback);
  return typeof value === "string" ? parseJsonText(value, name) : value;
};

const readBarcodeInput = async (
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<ReturnType<typeof readBarcode>> => {
  const binaryPropertyName = context.getNodeParameter(
    "binaryPropertyName",
    itemIndex,
    "data",
  ) as string;
  const buffer = await context.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
  assertBufferSize(
    buffer,
    normalizePositiveIntegerLimit(
      context.getNodeParameter("maxInputSizeBytes", itemIndex, 25_000_000),
      25_000_000,
      "Max Input Size Bytes",
    ),
    "Barcode input",
  );
  return readBarcode(buffer);
};

export const utilityOperationHandlers: Record<UtilityOperation, UtilityOperationHandler> =
  {
    [plugToolReadBarcodeOperation]: readBarcodeInput,
    [plugToolValidateCpfCnpjOperation]: (context, itemIndex) =>
      Promise.resolve(
        validateBrazilianDocument(context.getNodeParameter("document", itemIndex)),
      ),
    [plugToolFormatCpfCnpjOperation]: (context, itemIndex) =>
      Promise.resolve(
        formatBrazilianDocument(context.getNodeParameter("document", itemIndex)),
      ),
    [plugToolGenerateUuidOperation]: () => Promise.resolve(generateUuid()),
    [plugToolTransformJsonOperation]: (context, itemIndex) =>
      Promise.resolve(
        transformJson(
          context.getInputData()[itemIndex]?.json ?? {},
          context.getNodeParameter("jsonataExpression", itemIndex, "$"),
        ),
      ),
    [plugToolCsvToJsonOperation]: (context, itemIndex) =>
      Promise.resolve(csvToJson(context.getNodeParameter("csv", itemIndex), {})),
    [plugToolJsonToCsvOperation]: (context, itemIndex) =>
      Promise.resolve(jsonToCsv(getJsonParameter(context, "json", itemIndex, "[]"), {})),
    [plugToolNormalizeTextOperation]: (context, itemIndex) =>
      Promise.resolve(
        normalizeText(context.getNodeParameter("text", itemIndex), {
          trim: true,
          collapseWhitespace: true,
          removeAccents: true,
          caseMode: "none",
        }),
      ),
    [plugToolExtractRegexFieldsOperation]: (context, itemIndex) =>
      Promise.resolve(
        extractRegexFields(
          context.getNodeParameter("text", itemIndex),
          context.getNodeParameter("regexPattern", itemIndex),
          context.getNodeParameter("regexFlags", itemIndex, "g"),
        ),
      ),
    [plugToolValidateJsonSchemaOperation]: (context, itemIndex) =>
      Promise.resolve(
        validateJsonSchema(
          getJsonParameter(context, "json", itemIndex, "{}"),
          getJsonParameter(context, "jsonSchema", itemIndex, "{}"),
        ),
      ),
    [plugToolGenerateHashOperation]: (context, itemIndex) =>
      Promise.resolve(
        generateHash(
          context.getNodeParameter("text", itemIndex, "") as string,
          context.getNodeParameter("algorithm", itemIndex, "sha256") as string,
        ),
      ),
    [plugToolHmacSignOperation]: (context, itemIndex) =>
      Promise.resolve(
        hmacSign(
          context.getNodeParameter("text", itemIndex, "") as string,
          context.getNodeParameter("secret", itemIndex, ""),
          context.getNodeParameter("algorithm", itemIndex, "sha256") as string,
        ),
      ),
    [plugToolBase64Operation]: async (context, itemIndex) => {
      const mode = context.getNodeParameter("base64Mode", itemIndex, "encode");
      const maxInputSizeBytes = normalizePositiveIntegerLimit(
        context.getNodeParameter("maxInputSizeBytes", itemIndex, 25_000_000),
        25_000_000,
        "Max Input Size Bytes",
      );
      if (
        mode === "encode" &&
        context.getNodeParameter("base64EncodeInput", itemIndex, "text") === "binary"
      ) {
        const binaryPropertyName = context.getNodeParameter(
          "binaryPropertyName",
          itemIndex,
          "data",
        ) as string;
        const buffer = await context.helpers.getBinaryDataBuffer(
          itemIndex,
          binaryPropertyName,
        );
        assertBufferSize(buffer, maxInputSizeBytes, "Base64 input");
        return base64Encode(buffer);
      }

      const text = context.getNodeParameter("text", itemIndex, "") as string;
      assertBufferSize(Buffer.from(text, "utf8"), maxInputSizeBytes, "Base64 input");
      return mode === "decode" ? base64DecodeToText(text) : base64Encode(text);
    },
    [plugToolJwtDecodeOperation]: (context, itemIndex) =>
      Promise.resolve(decodeJwtUnsafe(context.getNodeParameter("jwt", itemIndex))),
    [plugToolEncryptTextOperation]: (context, itemIndex) =>
      Promise.resolve(
        encryptText(
          context.getNodeParameter("text", itemIndex),
          context.getNodeParameter("passphrase", itemIndex),
        ),
      ),
    [plugToolDecryptTextOperation]: (context, itemIndex) =>
      Promise.resolve(
        decryptText(
          getJsonParameter(context, "encryptedJson", itemIndex, "{}") as {
            readonly ciphertext: unknown;
            readonly iv: unknown;
            readonly salt: unknown;
            readonly tag: unknown;
          },
          context.getNodeParameter("passphrase", itemIndex),
        ),
      ),
    [plugToolFormatDateOperation]: (context, itemIndex) =>
      Promise.resolve(
        formatDateValue(
          context.getNodeParameter("date", itemIndex),
          context.getNodeParameter("dateFormat", itemIndex, "iso"),
        ),
      ),
    [plugToolParseDateOperation]: (context, itemIndex) =>
      Promise.resolve(parseDateValue(context.getNodeParameter("date", itemIndex))),
    [plugToolAddBusinessDaysOperation]: (context, itemIndex) =>
      Promise.resolve(
        addBusinessDaysValue(
          context.getNodeParameter("date", itemIndex),
          context.getNodeParameter("businessDays", itemIndex, 1),
        ),
      ),
    [plugToolFormatCurrencyOperation]: (context, itemIndex) =>
      Promise.resolve(
        formatCurrencyValue(
          context.getNodeParameter("amount", itemIndex, 0),
          context.getNodeParameter("locale", itemIndex, "en-US"),
          context.getNodeParameter("currency", itemIndex, "USD"),
        ),
      ),
    [plugToolNumberToWordsOperation]: (context, itemIndex) =>
      Promise.resolve(
        numberToWordsValue(
          context.getNodeParameter("number", itemIndex, 0),
          context.getNodeParameter("locale", itemIndex, "en-US"),
        ),
      ),
    [plugToolBuildSocketEventPayloadOperation]: (context, itemIndex) =>
      Promise.resolve(
        buildSocketEventPayload(
          context.getNodeParameter("eventName", itemIndex),
          getJsonParameter(context, "payloadJson", itemIndex, "{}"),
        ),
      ),
    [plugToolValidateClientTokenOperation]: (context, itemIndex) =>
      Promise.resolve(
        validateClientToken(context.getNodeParameter("clientToken", itemIndex)),
      ),
    [plugToolValidateAgentContextOperation]: (context, itemIndex) =>
      Promise.resolve(
        validateAgentContext(
          context.getNodeParameter("agentId", itemIndex),
          context.getNodeParameter("clientToken", itemIndex),
        ),
      ),
    [plugToolBuildSqlRequestOperation]: (context, itemIndex) =>
      Promise.resolve(
        buildSqlRequest(
          context.getNodeParameter("agentId", itemIndex),
          context.getNodeParameter("sql", itemIndex),
          getJsonParameter(context, "paramsJson", itemIndex, "[]"),
        ),
      ),
    [plugToolParseSqlRowsOperation]: (context, itemIndex) =>
      Promise.resolve(
        parseSqlRows(getJsonParameter(context, "rowsJson", itemIndex, "[]")),
      ),
    [plugToolGenerateAccessRequestSummaryOperation]: (context, itemIndex) =>
      Promise.resolve(
        generateAccessRequestSummary(
          getJsonParameter(context, "accessRequestJson", itemIndex, "{}"),
        ),
      ),
  };

export const executeUtilityOperation = (
  context: IExecuteFunctions,
  itemIndex: number,
  operation: UtilityOperation,
): Promise<unknown> => utilityOperationHandlers[operation](context, itemIndex);
