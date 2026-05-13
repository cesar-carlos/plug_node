import type { ICredentialTestRequest, Icon, INodeProperties } from "n8n-workflow";

import {
  plugDatabaseAccountCredentialName,
  plugDatabaseAccountCredentialTest,
} from "./plugAccountCredential";

export interface LegacyPlugCredentialAliasOptions {
  readonly name: string;
  readonly displayName: string;
  readonly icon: Icon;
}

export interface LegacyPlugCredentialAliasDefinition extends LegacyPlugCredentialAliasOptions {
  readonly extends: string[];
  readonly properties: INodeProperties[];
  readonly test: ICredentialTestRequest;
}

export const createLegacyPlugCredentialAlias = (
  options: LegacyPlugCredentialAliasOptions,
): LegacyPlugCredentialAliasDefinition => ({
  ...options,
  extends: [plugDatabaseAccountCredentialName],
  properties: [],
  test: plugDatabaseAccountCredentialTest,
});
