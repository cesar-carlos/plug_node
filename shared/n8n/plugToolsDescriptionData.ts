import type { INodeProperties } from "n8n-workflow";
import {
  outputJsonProperty,
  plugToolCsvToJsonOperation,
  plugToolExtractRegexFieldsOperation,
  plugToolJsonToCsvOperation,
  plugToolNormalizeTextOperation,
  plugToolTransformJsonOperation,
  plugToolValidateJsonSchemaOperation,
  toolTextField,
} from "./plugToolsDescriptionCommon";

export const buildPlugToolsDataProperties = (): INodeProperties[] => [
  toolTextField(
    plugToolTransformJsonOperation,
    "jsonataExpression",
    "JSONata Expression",
    "$",
    4,
  ),
  outputJsonProperty(plugToolTransformJsonOperation, "result"),
  toolTextField(plugToolCsvToJsonOperation, "csv", "CSV", "", 8),
  outputJsonProperty(plugToolCsvToJsonOperation, "rows"),
  toolTextField(plugToolJsonToCsvOperation, "json", "JSON", "[]", 8, "json"),
  outputJsonProperty(plugToolJsonToCsvOperation, "csv"),
  toolTextField(plugToolNormalizeTextOperation, "text", "Text", "", 4),
  outputJsonProperty(plugToolNormalizeTextOperation, "text"),
  toolTextField(plugToolExtractRegexFieldsOperation, "text", "Text", "", 4),
  toolTextField(
    plugToolExtractRegexFieldsOperation,
    "regexPattern",
    "Regex Pattern",
    "",
    2,
  ),
  toolTextField(plugToolExtractRegexFieldsOperation, "regexFlags", "Regex Flags", "g", 1),
  outputJsonProperty(plugToolExtractRegexFieldsOperation, "regex"),
  toolTextField(plugToolValidateJsonSchemaOperation, "json", "JSON", "{}", 8, "json"),
  toolTextField(
    plugToolValidateJsonSchemaOperation,
    "jsonSchema",
    "JSON Schema",
    "{}",
    8,
    "json",
  ),
  outputJsonProperty(plugToolValidateJsonSchemaOperation, "schemaValidation"),
];
