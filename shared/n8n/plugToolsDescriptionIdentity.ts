import type { INodeProperties } from "n8n-workflow";

import {
  binaryInputProperty,
  maxInputSizeProperty,
  outputJsonProperty,
  plugToolFormatCpfCnpjOperation,
  plugToolGenerateUuidOperation,
  plugToolReadBarcodeOperation,
  plugToolValidateCpfCnpjOperation,
  toolTextField,
} from "./plugToolsDescriptionCommon";

export const buildPlugToolsIdentityProperties = (): INodeProperties[] => [
  binaryInputProperty(plugToolReadBarcodeOperation),
  maxInputSizeProperty(plugToolReadBarcodeOperation),
  outputJsonProperty(plugToolReadBarcodeOperation, "barcode"),
  toolTextField(plugToolValidateCpfCnpjOperation, "document", "Document", "", 1),
  outputJsonProperty(plugToolValidateCpfCnpjOperation, "documentValidation"),
  toolTextField(plugToolFormatCpfCnpjOperation, "document", "Document", "", 1),
  outputJsonProperty(plugToolFormatCpfCnpjOperation, "formattedDocument"),
  outputJsonProperty(plugToolGenerateUuidOperation, "uuid"),
];
