import type { ICredentialType } from "n8n-workflow";

import { createLegacyPlugCredentialAlias } from "../generated/shared/n8n/legacyPlugCredentialAlias";

const credentialAlias = createLegacyPlugCredentialAlias({
  name: "plugDatabaseClientApi",
  displayName: "Legacy Plug Database Client API",
  icon: {
    light: "file:../nodes/PlugDatabase/plugDatabaseV2.svg",
    dark: "file:../nodes/PlugDatabase/plugDatabaseV2.dark.svg",
  },
});

export class PlugDatabaseClientApi implements ICredentialType {
  name = credentialAlias.name;

  displayName = credentialAlias.displayName;

  documentationUrl = "https://plug-server.se7esistemassinop.com.br/docs";

  icon = credentialAlias.icon;

  extends = credentialAlias.extends;

  properties = credentialAlias.properties;

  test = credentialAlias.test;
}
