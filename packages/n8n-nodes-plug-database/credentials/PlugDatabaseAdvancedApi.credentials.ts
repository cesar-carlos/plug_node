import type { ICredentialType } from "n8n-workflow";

import { createLegacyPlugCredentialAlias } from "../generated/shared/n8n/legacyPlugCredentialAlias";

const credentialAlias = createLegacyPlugCredentialAlias({
  name: "plugDatabaseAdvancedApi",
  displayName: "Legacy Plug Database Advanced API",
  icon: {
    light: "file:../nodes/PlugDatabase/plugDatabaseV2.svg",
    dark: "file:../nodes/PlugDatabase/plugDatabaseV2.dark.svg",
  },
});

export class PlugDatabaseAdvancedApi implements ICredentialType {
  name = credentialAlias.name;

  displayName = credentialAlias.displayName;

  documentationUrl = "https://plug-server.se7esistemassinop.com.br/docs";

  icon = credentialAlias.icon;

  extends = credentialAlias.extends;

  properties = credentialAlias.properties;

  test = credentialAlias.test;
}
