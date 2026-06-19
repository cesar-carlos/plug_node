import { Buffer } from "node:buffer";

import { vi } from "vitest";
import type {
  IBinaryData,
  IExecuteFunctions,
  INode,
  INodeExecutionData,
} from "n8n-workflow";

const defaultNode: INode = {
  id: "plug-tools-node",
  name: "Plug Tools",
  type: "plugTools",
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

export interface PlugToolsExecuteContextOptions {
  readonly parameters: Record<string, unknown>;
  readonly inputData?: INodeExecutionData[];
  readonly continueOnFail?: boolean;
  readonly binaryBuffer?: Buffer;
  readonly binaryBuffersByProperty?: Record<string, Buffer>;
}

export const createPlugToolsExecuteContext = (
  options: PlugToolsExecuteContextOptions,
): IExecuteFunctions & {
  readonly preparedBinaries: Array<{
    readonly buffer: Buffer;
    readonly fileName?: string;
    readonly mimeType?: string;
  }>;
  readonly getBinaryDataBufferMock: ReturnType<typeof vi.fn>;
} => {
  const preparedBinaries: Array<{
    buffer: Buffer;
    fileName?: string;
    mimeType?: string;
  }> = [];
  const getBinaryDataBufferMock = vi.fn(
    async (_itemIndex: number, propertyName: string): Promise<Buffer> => {
      const mapped = options.binaryBuffersByProperty?.[propertyName];
      if (mapped) {
        return mapped;
      }

      return options.binaryBuffer ?? Buffer.from("hello");
    },
  );

  const context = {
    helpers: {
      prepareBinaryData: vi.fn(
        async (
          buffer: Buffer,
          fileName?: string,
          mimeType?: string,
        ): Promise<IBinaryData> => {
          preparedBinaries.push({ buffer, fileName, mimeType });
          return {
            data: `binary-${preparedBinaries.length}`,
            mimeType: mimeType ?? "application/octet-stream",
            ...(fileName ? { fileName } : {}),
            fileSize: String(buffer.length),
          };
        },
      ),
      getBinaryDataBuffer: getBinaryDataBufferMock,
    },
    continueOnFail: () => options.continueOnFail ?? false,
    getCredentials: vi.fn(async () => ({
      user: "client@example.com",
      password: "secret",
      baseUrl: "https://plug-server.example.com/api/v1",
    })),
    getInputData: () => options.inputData ?? [{ json: { input: true } }],
    getNode: () => defaultNode,
    getNodeParameter: (
      name: string,
      itemIndex: number,
      fallbackValue?: unknown,
    ): unknown => {
      if (name in options.parameters) {
        const value = options.parameters[name];
        if (Array.isArray(value)) {
          return value[itemIndex] ?? fallbackValue;
        }

        return value;
      }

      return fallbackValue;
    },
    preparedBinaries,
    getBinaryDataBufferMock,
  };

  return context as unknown as IExecuteFunctions & {
    readonly preparedBinaries: Array<{
      readonly buffer: Buffer;
      readonly fileName?: string;
      readonly mimeType?: string;
    }>;
    readonly getBinaryDataBufferMock: ReturnType<typeof vi.fn>;
  };
};
