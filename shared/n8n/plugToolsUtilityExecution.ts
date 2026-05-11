import { Buffer } from "node:buffer";

import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

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
  base64DecodeToBuffer,
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
import {
  assertBufferSize,
  normalizeOutputBinaryProperty,
  normalizeOutputJsonProperty,
  normalizePositiveIntegerLimit,
  serializeErrorForContinueOnFail,
  toNodeOperationError,
  type PlugToolsExecutionConfig,
} from "./plugToolsCommon";

type UtilityOperation =
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

const getJsonParameter = (
  context: IExecuteFunctions,
  name: string,
  itemIndex: number,
  fallback: string,
): unknown => {
  const value = context.getNodeParameter(name, itemIndex, fallback);
  return typeof value === "string" ? parseJsonText(value, name) : value;
};

const calculateResult = async (
  context: IExecuteFunctions,
  itemIndex: number,
  operation: UtilityOperation,
): Promise<unknown> => {
  if (operation === plugToolReadBarcodeOperation) {
    const binaryPropertyName = context.getNodeParameter(
      "binaryPropertyName",
      itemIndex,
      "data",
    ) as string;
    const buffer = await context.helpers.getBinaryDataBuffer(
      itemIndex,
      binaryPropertyName,
    );
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
  }
  if (operation === plugToolValidateCpfCnpjOperation) {
    return validateBrazilianDocument(context.getNodeParameter("document", itemIndex));
  }
  if (operation === plugToolFormatCpfCnpjOperation) {
    return formatBrazilianDocument(context.getNodeParameter("document", itemIndex));
  }
  if (operation === plugToolGenerateUuidOperation) {
    return generateUuid();
  }
  if (operation === plugToolTransformJsonOperation) {
    return transformJson(
      context.getInputData()[itemIndex]?.json ?? {},
      context.getNodeParameter("jsonataExpression", itemIndex, "$"),
    );
  }
  if (operation === plugToolCsvToJsonOperation) {
    return csvToJson(context.getNodeParameter("csv", itemIndex), {});
  }
  if (operation === plugToolJsonToCsvOperation) {
    return jsonToCsv(getJsonParameter(context, "json", itemIndex, "[]"), {});
  }
  if (operation === plugToolNormalizeTextOperation) {
    return normalizeText(context.getNodeParameter("text", itemIndex), {
      trim: true,
      collapseWhitespace: true,
      removeAccents: true,
      caseMode: "none",
    });
  }
  if (operation === plugToolExtractRegexFieldsOperation) {
    return extractRegexFields(
      context.getNodeParameter("text", itemIndex),
      context.getNodeParameter("regexPattern", itemIndex),
      context.getNodeParameter("regexFlags", itemIndex, "g"),
    );
  }
  if (operation === plugToolValidateJsonSchemaOperation) {
    return validateJsonSchema(
      getJsonParameter(context, "json", itemIndex, "{}"),
      getJsonParameter(context, "jsonSchema", itemIndex, "{}"),
    );
  }
  if (operation === plugToolGenerateHashOperation) {
    return generateHash(
      context.getNodeParameter("text", itemIndex, "") as string,
      context.getNodeParameter("algorithm", itemIndex, "sha256") as string,
    );
  }
  if (operation === plugToolHmacSignOperation) {
    return hmacSign(
      context.getNodeParameter("text", itemIndex, "") as string,
      context.getNodeParameter("secret", itemIndex, ""),
      context.getNodeParameter("algorithm", itemIndex, "sha256") as string,
    );
  }
  if (operation === plugToolBase64Operation) {
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
  }
  if (operation === plugToolJwtDecodeOperation) {
    return decodeJwtUnsafe(context.getNodeParameter("jwt", itemIndex));
  }
  if (operation === plugToolEncryptTextOperation) {
    return encryptText(
      context.getNodeParameter("text", itemIndex),
      context.getNodeParameter("passphrase", itemIndex),
    );
  }
  if (operation === plugToolDecryptTextOperation) {
    return decryptText(
      getJsonParameter(context, "encryptedJson", itemIndex, "{}") as unknown as {
        readonly ciphertext: unknown;
        readonly iv: unknown;
        readonly salt: unknown;
        readonly tag: unknown;
      },
      context.getNodeParameter("passphrase", itemIndex),
    );
  }
  if (operation === plugToolFormatDateOperation) {
    return formatDateValue(
      context.getNodeParameter("date", itemIndex),
      context.getNodeParameter("dateFormat", itemIndex, "iso"),
    );
  }
  if (operation === plugToolParseDateOperation) {
    return parseDateValue(context.getNodeParameter("date", itemIndex));
  }
  if (operation === plugToolAddBusinessDaysOperation) {
    return addBusinessDaysValue(
      context.getNodeParameter("date", itemIndex),
      context.getNodeParameter("businessDays", itemIndex, 1),
    );
  }
  if (operation === plugToolFormatCurrencyOperation) {
    return formatCurrencyValue(
      context.getNodeParameter("amount", itemIndex, 0),
      context.getNodeParameter("locale", itemIndex, "en-US"),
      context.getNodeParameter("currency", itemIndex, "USD"),
    );
  }
  if (operation === plugToolNumberToWordsOperation) {
    return numberToWordsValue(
      context.getNodeParameter("number", itemIndex, 0),
      context.getNodeParameter("locale", itemIndex, "en-US"),
    );
  }
  if (operation === plugToolBuildSocketEventPayloadOperation) {
    return buildSocketEventPayload(
      context.getNodeParameter("eventName", itemIndex),
      getJsonParameter(context, "payloadJson", itemIndex, "{}"),
    );
  }
  if (operation === plugToolValidateClientTokenOperation) {
    return validateClientToken(context.getNodeParameter("clientToken", itemIndex));
  }
  if (operation === plugToolValidateAgentContextOperation) {
    return validateAgentContext(
      context.getNodeParameter("agentId", itemIndex),
      context.getNodeParameter("clientToken", itemIndex),
    );
  }
  if (operation === plugToolBuildSqlRequestOperation) {
    return buildSqlRequest(
      context.getNodeParameter("agentId", itemIndex),
      context.getNodeParameter("sql", itemIndex),
      getJsonParameter(context, "paramsJson", itemIndex, "[]"),
    );
  }
  if (operation === plugToolParseSqlRowsOperation) {
    return parseSqlRows(getJsonParameter(context, "rowsJson", itemIndex, "[]"));
  }

  return generateAccessRequestSummary(
    getJsonParameter(context, "accessRequestJson", itemIndex, "{}"),
  );
};

const executeBase64BinaryDecode = async (
  context: IExecuteFunctions,
  item: INodeExecutionData,
  itemIndex: number,
  operation: typeof plugToolBase64Operation,
): Promise<INodeExecutionData> => {
  const maxInputSizeBytes = normalizePositiveIntegerLimit(
    context.getNodeParameter("maxInputSizeBytes", itemIndex, 25_000_000),
    25_000_000,
    "Max Input Size Bytes",
  );
  const text = context.getNodeParameter("text", itemIndex, "") as string;
  assertBufferSize(Buffer.from(text, "utf8"), maxInputSizeBytes, "Base64 input");
  const outputBinaryProperty = normalizeOutputBinaryProperty(
    context.getNodeParameter("outputBinaryProperty", itemIndex, "data"),
  );
  const buffer = base64DecodeToBuffer(text);
  const binaryData = await context.helpers.prepareBinaryData(
    buffer,
    "decoded.bin",
    "application/octet-stream",
  );

  return {
    json: {
      ...item.json,
      __plugTools: {
        operation,
        mode: "decode",
        outputBinaryProperty,
        sizeBytes: buffer.length,
      },
    },
    binary: {
      ...(item.binary ?? {}),
      [outputBinaryProperty]: binaryData,
    },
    pairedItem: { item: itemIndex },
  };
};

export const executePlugToolsUtilityNode = async (
  context: IExecuteFunctions,
  config: PlugToolsExecutionConfig,
  operation: UtilityOperation,
): Promise<INodeExecutionData[][]> => {
  const items = context.getInputData();
  const sourceItems: INodeExecutionData[] = items.length > 0 ? items : [{ json: {} }];
  const outputItems: INodeExecutionData[] = [];

  for (let itemIndex = 0; itemIndex < sourceItems.length; itemIndex += 1) {
    try {
      if (
        operation === plugToolBase64Operation &&
        context.getNodeParameter("base64Mode", itemIndex, "encode") === "decode" &&
        context.getNodeParameter("base64DecodeOutput", itemIndex, "text") === "binary"
      ) {
        outputItems.push(
          await executeBase64BinaryDecode(
            context,
            sourceItems[itemIndex],
            itemIndex,
            operation,
          ),
        );
        continue;
      }

      const outputJsonProperty = normalizeOutputJsonProperty(
        context.getNodeParameter("outputJsonProperty", itemIndex, "result"),
        "result",
        "Output JSON Property",
      );
      const result = await calculateResult(context, itemIndex, operation);
      outputItems.push({
        json: {
          ...sourceItems[itemIndex].json,
          [outputJsonProperty]: result,
          __plugTools: { operation },
        } as INodeExecutionData["json"],
        binary: sourceItems[itemIndex].binary,
        pairedItem: { item: itemIndex },
      });
    } catch (error: unknown) {
      if (context.continueOnFail()) {
        outputItems.push({
          json: {
            ...sourceItems[itemIndex].json,
            error: serializeErrorForContinueOnFail(error),
          },
          pairedItem: { item: itemIndex },
        });
        continue;
      }

      throw toNodeOperationError(context, error, config.nodeDisplayName, itemIndex);
    }
  }

  return [outputItems];
};
