import type { Icon, ICredentialType } from "n8n-workflow";

import {
  plugDatabaseAccountCredentialDisplayName,
  plugDatabaseAccountCredentialDocumentationUrl,
  plugDatabaseAccountCredentialName,
  plugDatabaseAccountCredentialProperties,
  plugDatabaseAccountCredentialTest,
} from "../generated/shared/n8n/plugAccountCredential";

export class PlugDatabaseAccountApi implements ICredentialType {
  name = plugDatabaseAccountCredentialName;

  displayName = plugDatabaseAccountCredentialDisplayName;

  documentationUrl = plugDatabaseAccountCredentialDocumentationUrl;

  icon: Icon = {
    light: "file:../nodes/PlugDatabaseAdvanced/plugDatabaseAdvancedV2.svg",
    dark: "file:../nodes/PlugDatabaseAdvanced/plugDatabaseAdvancedV2.dark.svg",
  };

  properties = plugDatabaseAccountCredentialProperties;

  test = plugDatabaseAccountCredentialTest;
}
