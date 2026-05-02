import { vi } from "vitest";

import type {
  IExecuteFunctions,
  IHttpRequestOptions,
  INode,
  INodeExecutionData,
} from "n8n-workflow";

import type { PlugCredentials } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";

export interface MockExecuteContextOptions {
  readonly credentials: PlugCredentials;
  readonly parameters: Record<string, unknown>;
  readonly responses: unknown[];
  readonly inputData?: INodeExecutionData[];
  readonly continueOnFail?: boolean;
}

const defaultNode: INode = {
  id: "plug-database-node",
  name: "Plug Database",
  type: "plugDatabase",
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

export const createMockExecuteContext = (
  options: MockExecuteContextOptions,
): IExecuteFunctions & { readonly httpRequestMock: ReturnType<typeof vi.fn> } => {
  const responseQueue = [...options.responses];
  const httpRequestMock = vi.fn(async (_request: IHttpRequestOptions) => {
    if (responseQueue.length === 0) {
      throw new Error("No mocked HTTP response left in the queue");
    }

    return responseQueue.shift();
  });

  const context = {
    helpers: {
      httpRequest: httpRequestMock,
    },
    continueOnFail: () => options.continueOnFail ?? false,
    getInputData: () => options.inputData ?? [],
    getCredentials: vi.fn(async () => options.credentials),
    getNode: () => defaultNode,
    getNodeParameter: (
      name: string,
      _itemIndex: number,
      fallbackValue?: unknown,
    ): unknown => {
      if (name in options.parameters) {
        return options.parameters[name];
      }

      return fallbackValue;
    },
    httpRequestMock,
  };

  return context as IExecuteFunctions & {
    readonly httpRequestMock: ReturnType<typeof vi.fn>;
  };
};
