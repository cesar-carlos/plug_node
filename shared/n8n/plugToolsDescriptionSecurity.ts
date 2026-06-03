import type { INodeProperties } from "n8n-workflow";
import {
  addOperationDisplayOption,
  maxInputSizeProperty,
  outputJsonProperty,
  passwordField,
  plugToolBase64Operation,
  plugToolDecryptTextOperation,
  plugToolEncryptTextOperation,
  plugToolGenerateHashOperation,
  plugToolHmacSignOperation,
  plugToolJwtDecodeOperation,
  toolTextField,
} from "./plugToolsDescriptionCommon";

export const buildPlugToolsSecurityProperties = (): INodeProperties[] => [
  toolTextField(plugToolGenerateHashOperation, "text", "Text", "", 4),
  toolTextField(plugToolGenerateHashOperation, "algorithm", "Algorithm", "sha256", 1),
  outputJsonProperty(plugToolGenerateHashOperation, "hash"),
  toolTextField(plugToolHmacSignOperation, "text", "Text", "", 4),
  passwordField(plugToolHmacSignOperation, "secret", "Secret"),
  toolTextField(plugToolHmacSignOperation, "algorithm", "Algorithm", "sha256", 1),
  outputJsonProperty(plugToolHmacSignOperation, "signature"),
  addOperationDisplayOption(
    {
      displayName: "Mode",
      name: "base64Mode",
      type: "options",
      default: "encode",
      options: [
        { name: "Encode", value: "encode" },
        { name: "Decode", value: "decode" },
      ],
    },
    plugToolBase64Operation,
  ),
  addOperationDisplayOption(
    {
      displayName: "Encode Input",
      name: "base64EncodeInput",
      type: "options",
      default: "text",
      options: [
        { name: "Text", value: "text" },
        { name: "Binary", value: "binary" },
      ],
      displayOptions: {
        show: {
          base64Mode: ["encode"],
        },
      },
    },
    plugToolBase64Operation,
  ),
  addOperationDisplayOption(
    {
      displayName: "Text",
      name: "text",
      type: "string",
      default: "",
      required: true,
      typeOptions: {
        rows: 4,
      },
      displayOptions: {
        show: {
          base64Mode: ["encode", "decode"],
          base64EncodeInput: ["text"],
        },
      },
    },
    plugToolBase64Operation,
  ),
  addOperationDisplayOption(
    {
      displayName: "Decode Output",
      name: "base64DecodeOutput",
      type: "options",
      default: "text",
      options: [
        { name: "Text", value: "text" },
        { name: "Binary", value: "binary" },
      ],
      displayOptions: {
        show: {
          base64Mode: ["decode"],
        },
      },
    },
    plugToolBase64Operation,
  ),
  addOperationDisplayOption(
    {
      displayName: "Binary Property",
      name: "binaryPropertyName",
      type: "string",
      default: "data",
      displayOptions: {
        show: {
          base64Mode: ["encode"],
          base64EncodeInput: ["binary"],
        },
      },
      description: "Binary property to encode as Base64.",
    },
    plugToolBase64Operation,
  ),
  addOperationDisplayOption(
    {
      displayName: "Output Binary Property",
      name: "outputBinaryProperty",
      type: "string",
      default: "data",
      displayOptions: {
        show: {
          base64Mode: ["decode"],
          base64DecodeOutput: ["binary"],
        },
      },
      description: "Binary property where decoded Base64 data should be stored.",
    },
    plugToolBase64Operation,
  ),
  maxInputSizeProperty(plugToolBase64Operation),
  outputJsonProperty(plugToolBase64Operation, "base64"),
  toolTextField(plugToolJwtDecodeOperation, "jwt", "JWT", "", 4),
  outputJsonProperty(plugToolJwtDecodeOperation, "jwt"),
  toolTextField(plugToolEncryptTextOperation, "text", "Plaintext", "", 4),
  passwordField(plugToolEncryptTextOperation, "passphrase", "Passphrase"),
  outputJsonProperty(plugToolEncryptTextOperation, "encrypted"),
  toolTextField(
    plugToolDecryptTextOperation,
    "encryptedJson",
    "Encrypted JSON",
    "{}",
    8,
    "json",
  ),
  passwordField(plugToolDecryptTextOperation, "passphrase", "Passphrase"),
  outputJsonProperty(plugToolDecryptTextOperation, "plaintext"),
];
