import type { INodeProperties } from "n8n-workflow";
import {
  outputJsonProperty,
  plugToolAddBusinessDaysOperation,
  plugToolFormatCurrencyOperation,
  plugToolFormatDateOperation,
  plugToolNumberToWordsOperation,
  plugToolParseDateOperation,
  toolTextField,
} from "./plugToolsDescriptionCommon";

export const buildPlugToolsDateValueProperties = (): INodeProperties[] => [
  toolTextField(plugToolFormatDateOperation, "date", "Date", "", 1),
  toolTextField(plugToolFormatDateOperation, "dateFormat", "Date Format", "iso", 1),
  outputJsonProperty(plugToolFormatDateOperation, "date"),
  toolTextField(plugToolParseDateOperation, "date", "Date", "", 1),
  outputJsonProperty(plugToolParseDateOperation, "date"),
  toolTextField(plugToolAddBusinessDaysOperation, "date", "Date", "", 1),
  toolTextField(
    plugToolAddBusinessDaysOperation,
    "businessDays",
    "Business Days",
    "1",
    1,
  ),
  outputJsonProperty(plugToolAddBusinessDaysOperation, "date"),
  toolTextField(plugToolFormatCurrencyOperation, "amount", "Amount", "0", 1),
  toolTextField(plugToolFormatCurrencyOperation, "locale", "Locale", "en-US", 1),
  toolTextField(plugToolFormatCurrencyOperation, "currency", "Currency", "USD", 1),
  outputJsonProperty(plugToolFormatCurrencyOperation, "currency"),
  toolTextField(plugToolNumberToWordsOperation, "number", "Number", "0", 1),
  toolTextField(plugToolNumberToWordsOperation, "locale", "Locale", "en-US", 1),
  outputJsonProperty(plugToolNumberToWordsOperation, "words"),
];
