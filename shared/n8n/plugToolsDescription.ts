export * from "./plugToolsDescriptionCommon";
export * from "./plugToolsDescriptionOperations";
export * from "./plugToolsDescriptionPdf";
export * from "./plugToolsDescriptionBarcode";
export * from "./plugToolsDescriptionDocument";
export * from "./plugToolsDescriptionImage";
export * from "./plugToolsDescriptionIdentity";
export * from "./plugToolsDescriptionData";
export * from "./plugToolsDescriptionSecurity";
export * from "./plugToolsDescriptionDate";
export * from "./plugToolsDescriptionPlugSpecific";
export * from "./plugToolsDescriptionSocketEvent";

import type { INodeProperties } from "n8n-workflow";

import type { PlugToolsPropertiesOptions } from "./plugToolsDescriptionCommon";
import { buildPlugToolsBarcodeProperties } from "./plugToolsDescriptionBarcode";
import {
  buildPlugToolsCategoryProperty,
  buildPlugToolsOperationProperties,
} from "./plugToolsDescriptionOperations";
import { buildPlugToolsIdentityProperties } from "./plugToolsDescriptionIdentity";
import { buildPlugToolsDataProperties } from "./plugToolsDescriptionData";
import { buildPlugToolsDateValueProperties } from "./plugToolsDescriptionDate";
import { buildPlugToolsDocumentProperties } from "./plugToolsDescriptionDocument";
import { buildPlugToolsImageProperties } from "./plugToolsDescriptionImage";
import { buildPlugToolsPdfProperties } from "./plugToolsDescriptionPdf";
import { buildPlugToolsPlugSpecificProperties } from "./plugToolsDescriptionPlugSpecific";
import { buildPlugToolsSecurityProperties } from "./plugToolsDescriptionSecurity";
import { buildPlugToolsSocketEventProperties } from "./plugToolsDescriptionSocketEvent";

export const buildPlugToolsProperties = (
  options: PlugToolsPropertiesOptions,
): INodeProperties[] => [
  buildPlugToolsCategoryProperty(),
  ...buildPlugToolsOperationProperties(options),
  ...buildPlugToolsPdfProperties(),
  ...buildPlugToolsDocumentProperties(),
  ...buildPlugToolsImageProperties(),
  ...buildPlugToolsBarcodeProperties(),
  ...buildPlugToolsIdentityProperties(),
  ...buildPlugToolsDataProperties(),
  ...buildPlugToolsSecurityProperties(),
  ...buildPlugToolsDateValueProperties(),
  ...buildPlugToolsPlugSpecificProperties(),
  ...buildPlugToolsSocketEventProperties(options),
];
