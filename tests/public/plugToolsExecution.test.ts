import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";
import type {
  IBinaryData,
  IExecuteFunctions,
  IHttpRequestOptions,
  INode,
  INodeExecutionData,
} from "n8n-workflow";

import {
  executePlugToolsBarcodeNode,
  executePlugToolsPdfNode,
  executePlugToolsUtilityNode,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/n8n/plugToolsExecution";
import type {
  PlugToolsSocketEventListenInput,
  PlugToolsSocketEventPublishInput,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/n8n/plugToolsExecution";
import { executePlugClientNode } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugClientExecution";
import { executePlugClientNode as executeAdvancedPlugClientNode } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/n8n/plugClientExecution";
import { PlugError } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/contracts/errors";
import { PlugDatabaseAdvancedBarcode } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedBarcode/PlugDatabaseAdvancedBarcode.node";
import { PlugDatabaseAdvancedPdf } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedPdf/PlugDatabaseAdvancedPdf.node";
import { PlugDatabaseAdvancedSocketEvent } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedSocketEvent/PlugDatabaseAdvancedSocketEvent.node";
import type { HtmlToPdfRenderer } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/tools/pdf";

const defaultNode: INode = {
  id: "plug-tools-node",
  name: "Plug Tools",
  type: "plugTools",
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

interface PreparedBinary {
  readonly buffer: Buffer;
  readonly fileName?: string;
  readonly mimeType?: string;
}

interface ToolContextOptions {
  readonly parameters: Record<string, unknown>;
  readonly inputData?: INodeExecutionData[];
  readonly continueOnFail?: boolean;
  readonly publishStatusCode?: number;
  readonly publishBody?: unknown;
  readonly binaryBuffer?: Buffer;
  readonly credentials?: {
    readonly payloadSigningKey?: string;
    readonly payloadSigningKeyId?: string;
  };
}

const createToolContext = (
  options: ToolContextOptions,
): IExecuteFunctions & {
  readonly preparedBinaries: PreparedBinary[];
  readonly prepareBinaryDataMock: ReturnType<typeof vi.fn>;
  readonly requests: IHttpRequestOptions[];
} => {
  const preparedBinaries: PreparedBinary[] = [];
  const requests: IHttpRequestOptions[] = [];
  const prepareBinaryDataMock = vi.fn(
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
  );
  const httpRequest = vi.fn(async (request: IHttpRequestOptions) => {
    requests.push(request);
    if (String(request.url).endsWith("/client-auth/login")) {
      return {
        statusCode: 200,
        headers: {},
        body: {
          accessToken: "access-1",
          refreshToken: "refresh-1",
          client: {
            id: "client-1",
            userId: "user-1",
            email: "client@example.com",
            name: "Plug",
            lastName: "Client",
            status: "active",
            role: "client",
          },
        },
      };
    }

    return {
      statusCode: options.publishStatusCode ?? 202,
      headers: {},
      body: options.publishBody ?? {
        success: true,
        eventId: "event-1",
        eventName: "client:custom.status.changed",
        recipients: 3,
        idempotencyKey: "publish-1",
        idempotentReplay: false,
        requestId: "request-1",
      },
    };
  });

  const context = {
    helpers: {
      prepareBinaryData: prepareBinaryDataMock,
      httpRequest,
      assertBinaryData: vi.fn(
        (_itemIndex: number, propertyName: string): IBinaryData => ({
          data: "",
          fileName: `${propertyName}.txt`,
          mimeType: "text/plain",
        }),
      ),
      getBinaryDataBuffer: vi.fn(
        async () => options.binaryBuffer ?? Buffer.from("hello"),
      ),
    },
    continueOnFail: () => options.continueOnFail ?? false,
    getCredentials: vi.fn(async () => ({
      user: "client@example.com",
      password: "secret",
      baseUrl: "https://plug-server.example.com/api/v1",
      agentId: "agent-1",
      clientToken: "client-token",
      payloadSigningKey: options.credentials?.payloadSigningKey ?? "",
      payloadSigningKeyId: options.credentials?.payloadSigningKeyId ?? "",
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
    prepareBinaryDataMock,
    requests,
  };

  return context as unknown as IExecuteFunctions & {
    readonly preparedBinaries: PreparedBinary[];
    readonly prepareBinaryDataMock: ReturnType<typeof vi.fn>;
    readonly requests: IHttpRequestOptions[];
  };
};

describe("Plug tools execution", () => {
  it("dispatches consolidated Plug Database Tools operations", async () => {
    const context = createToolContext({
      parameters: {
        resource: "tools",
        operation: "generateCode",
        text: "consolidated-tools",
        barcodeType: "qrcode",
        outputFormat: "svg",
        fileName: "tool-code",
        outputBinaryProperty: "code",
        renderOptions: {
          scale: 2,
        },
        advancedOptionsJson: "{}",
        includePlugToolsMetadata: true,
        metadataProperty: "toolMeta",
      },
    });

    const output = await executePlugClientNode(context, {
      supportsSocket: false,
      credentialName: "plugDatabaseApi",
      nodeDisplayName: "Plug Database",
    });

    expect(output[0]?.[0]?.json.toolMeta).toMatchObject({
      operation: "generateCode",
      outputBinaryProperty: "code",
    });
    expect(output[0]?.[0]?.binary?.code?.mimeType).toBe("image/svg+xml");
  });

  it("executes JSON, identity, and security utility tools item by item", async () => {
    const transformContext = createToolContext({
      inputData: [{ json: { amount: 7, nested: { value: "ok" } } }],
      parameters: {
        operation: "transformJson",
        jsonataExpression: "{'total': amount, 'value': nested.value}",
        outputJsonProperty: "transformed",
      },
    });

    const transformed = await executePlugToolsUtilityNode(
      transformContext,
      { nodeDisplayName: "Plug Database" },
      "transformJson",
    );

    expect(transformed[0]?.[0]?.json.transformed).toEqual({
      total: 7,
      value: "ok",
    });

    const documentContext = createToolContext({
      parameters: {
        operation: "validateCpfCnpj",
        document: "529.982.247-25",
        outputJsonProperty: "validation",
      },
    });

    const documentOutput = await executePlugToolsUtilityNode(
      documentContext,
      { nodeDisplayName: "Plug Database" },
      "validateCpfCnpj",
    );

    expect(documentOutput[0]?.[0]?.json.validation).toMatchObject({
      type: "cpf",
      valid: true,
    });

    const hashContext = createToolContext({
      parameters: {
        operation: "generateHash",
        text: "plug",
        algorithm: "sha256",
        outputJsonProperty: "hash",
      },
    });

    const hashOutput = await executePlugToolsUtilityNode(
      hashContext,
      { nodeDisplayName: "Plug Database" },
      "generateHash",
    );

    expect(hashOutput[0]?.[0]?.json.hash).toBe(
      "0daf0c9ca37fec6e1d5a340073fb43a19c89c50c02827c9991295f89987c7c90",
    );
  });

  it("encodes and decodes Base64 binary data", async () => {
    const binaryPayload = Buffer.from([0, 1, 2, 3, 255]);
    const encodeContext = createToolContext({
      binaryBuffer: binaryPayload,
      parameters: {
        operation: "base64",
        base64Mode: "encode",
        base64EncodeInput: "binary",
        binaryPropertyName: "payload",
        maxInputSizeBytes: 100,
        outputJsonProperty: "encoded",
      },
    });

    const encodedOutput = await executePlugToolsUtilityNode(
      encodeContext,
      { nodeDisplayName: "Plug Database" },
      "base64",
    );

    expect(encodedOutput[0]?.[0]?.json.encoded).toBe(binaryPayload.toString("base64"));

    const decodeContext = createToolContext({
      parameters: {
        operation: "base64",
        base64Mode: "decode",
        base64DecodeOutput: "binary",
        text: binaryPayload.toString("base64"),
        outputBinaryProperty: "decoded",
        maxInputSizeBytes: 100,
      },
    });

    const decodedOutput = await executePlugToolsUtilityNode(
      decodeContext,
      { nodeDisplayName: "Plug Database" },
      "base64",
    );

    expect(decodedOutput[0]?.[0]?.json.__plugTools).toMatchObject({
      operation: "base64",
      mode: "decode",
      outputBinaryProperty: "decoded",
      sizeBytes: binaryPayload.length,
    });
    expect(decodedOutput[0]?.[0]?.binary?.decoded).toMatchObject({
      mimeType: "application/octet-stream",
      fileName: "decoded.bin",
    });
    expect(decodeContext.preparedBinaries[0].buffer).toEqual(binaryPayload);
  });

  it("applies binary input size limits before tool processing", async () => {
    const context = createToolContext({
      continueOnFail: true,
      binaryBuffer: Buffer.alloc(8),
      parameters: {
        operation: "readBarcode",
        binaryPropertyName: "data",
        maxInputSizeBytes: 4,
        outputJsonProperty: "barcode",
      },
    });

    const output = await executePlugToolsUtilityNode(
      context,
      { nodeDisplayName: "Plug Database" },
      "readBarcode",
    );

    expect(output[0]?.[0]?.json.error).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message: "Barcode input size must be less than or equal to 4 bytes",
    });
  });

  it("keeps the legacy advanced Barcode node executable for existing workflows", async () => {
    const node = new PlugDatabaseAdvancedBarcode();
    const context = createToolContext({
      parameters: {
        operation: "generateCode",
        text: "legacy-barcode",
        barcodeType: "qrcode",
        outputFormat: "svg",
        fileName: "legacy-code",
        outputBinaryProperty: "code",
        renderOptions: {
          scale: 2,
        },
        advancedOptionsJson: "{}",
        includePlugToolsMetadata: true,
        metadataProperty: "toolMeta",
      },
    });

    const output = await node.execute.call(context);

    expect(output[0][0].json.toolMeta).toMatchObject({
      operation: "generateCode",
      fileName: "legacy-code.svg",
      outputBinaryProperty: "code",
    });
    expect(output[0][0].binary?.code?.mimeType).toBe("image/svg+xml");
  });

  it("keeps the legacy advanced PDF node on the shared execution path", async () => {
    const node = new PlugDatabaseAdvancedPdf();
    const context = createToolContext({
      continueOnFail: true,
      parameters: {
        operation: "htmlToPdf",
        html: "<html><body>Legacy PDF</body></html>",
        css: "",
        fileName: "legacy.pdf",
        outputBinaryProperty: "data",
        browserOptions: {
          browserChannel: "safari",
        },
        pdfOptions: {},
      },
    });

    const output = await node.execute.call(context);

    expect(output[0][0].json.error).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message: "Browser Channel must be auto, chromium, chrome, or msedge",
    });
  });

  it("keeps the legacy advanced Socket Event node executable over REST", async () => {
    const node = new PlugDatabaseAdvancedSocketEvent();
    const context = createToolContext({
      parameters: {
        operation: "publishEvent",
        publishChannel: "rest",
        eventName: "client:custom.status.changed",
        payloadJson: '{"status":"ready"}',
        payloadFrameCompression: "default",
        idempotencyKey: "publish-1",
        timeoutMs: 15000,
        includePlugMetadata: true,
        attachments: {},
      },
    });

    const output = await node.execute.call(context);

    expect(output[0][0].json).toMatchObject({
      success: true,
      eventId: "event-1",
      requestId: "request-1",
      idempotentReplay: false,
      __plug: {
        channel: "rest",
        operation: "publishCustomSocketEvent",
        requestId: "request-1",
        idempotentReplay: false,
        deliveryStatus: "delivered",
      },
    });
    expect(context.requests[1]).toMatchObject({
      method: "POST",
      url: "https://plug-server.example.com/api/v1/client/me/socket-events",
    });
  });

  it("publishes Socket Event through public Tools over REST only", async () => {
    const context = createToolContext({
      parameters: {
        resource: "tools",
        operation: "publishSocketEvent",
        publishChannel: "rest",
        eventName: "client:custom.status.changed",
        payloadJson: '{"status":"ready"}',
        payloadFrameCompression: "default",
        idempotencyKey: "publish-1",
        timeoutMs: 15000,
        includePlugMetadata: true,
        attachments: {},
      },
    });

    const output = await executePlugClientNode(context, {
      supportsSocket: false,
      credentialName: "plugDatabaseApi",
      nodeDisplayName: "Plug Database",
    });

    expect(output[0][0].json).toMatchObject({
      success: true,
      eventId: "event-1",
      requestId: "request-1",
      idempotentReplay: false,
      __plug: {
        channel: "rest",
        operation: "publishCustomSocketEvent",
        requestId: "request-1",
        idempotentReplay: false,
        deliveryStatus: "delivered",
        attachmentCount: 0,
      },
    });
    expect(context.requests[1]).toMatchObject({
      method: "POST",
      url: "https://plug-server.example.com/api/v1/client/me/socket-events",
      body: {
        eventName: "client:custom.status.changed",
        payload: { status: "ready" },
        payloadFrameCompression: "default",
      },
    });
    expect(context.requests[1].headers).toMatchObject({
      authorization: "Bearer access-1",
      "idempotency-key": "publish-1",
    });
  });

  it("rejects Socket Event socket publishing in public Tools", async () => {
    const context = createToolContext({
      continueOnFail: true,
      parameters: {
        resource: "tools",
        operation: "publishSocketEvent",
        publishChannel: "socket",
        eventName: "client:custom.status.changed",
        payloadJson: '{"status":"ready"}',
        payloadFrameCompression: "default",
        idempotencyKey: "",
        timeoutMs: 15000,
        attachments: {},
      },
    });

    const output = await executePlugClientNode(context, {
      supportsSocket: false,
      credentialName: "plugDatabaseApi",
      nodeDisplayName: "Plug Database",
    });

    expect(output[0][0].json.error).toMatchObject({
      message: "Publish Channel must be REST",
      name: "NodeOperationError",
    });
    expect(context.requests).toHaveLength(0);
  });

  it("publishes Socket Event through advanced Tools with an injected Socket publisher", async () => {
    const socketEventPublisher = vi.fn(
      async (input: PlugToolsSocketEventPublishInput) => {
        expect(input).toMatchObject({
          eventName: "client:custom.status.changed",
          payload: { status: "ready" },
          payloadFrameCompression: "default",
          idempotencyKey: "publish-1",
          timeoutMs: 2000,
          attachments: [
            {
              fieldName: "files",
              originalName: "invoice.txt",
              mimeType: "text/plain",
              sizeBytes: 5,
              base64: Buffer.from("hello").toString("base64"),
            },
          ],
        });
        expect(input.session.accessToken).toBe("access-1");
        return {
          success: true,
          eventId: "event-socket-1",
          eventName: input.eventName,
          recipients: 4,
          idempotencyKey: input.idempotencyKey,
          idempotentReplay: false,
          requestId: "request-socket-1",
        };
      },
    );
    const context = createToolContext({
      parameters: {
        resource: "tools",
        operation: "publishSocketEvent",
        publishChannel: "socket",
        eventName: "client:custom.status.changed",
        payloadJson: '{"status":"ready"}',
        payloadFrameCompression: "default",
        idempotencyKey: "publish-1",
        timeoutMs: 15000,
        socketAckTimeoutMs: 2000,
        includePlugMetadata: true,
        attachments: {
          values: [{ binaryPropertyName: "invoice" }],
        },
      },
    });

    const output = await executeAdvancedPlugClientNode(context, {
      supportsSocket: true,
      credentialName: "plugDatabaseAdvancedApi",
      nodeDisplayName: "Plug Database Advanced",
      toolSocketEventPublisher: socketEventPublisher,
    });

    expect(output[0][0].json).toMatchObject({
      success: true,
      eventId: "event-socket-1",
      recipients: 4,
      requestId: "request-socket-1",
      idempotentReplay: false,
      __plug: {
        channel: "socket",
        operation: "publishCustomSocketEvent",
        requestId: "request-socket-1",
        idempotentReplay: false,
        deliveryStatus: "delivered",
        attachmentCount: 1,
      },
    });
    expect(context.requests).toHaveLength(1);
    expect(socketEventPublisher).toHaveBeenCalledOnce();
  });

  it("waits for a Socket Event through advanced Tools with an injected listener", async () => {
    const socketEventListener = vi.fn(async (input: PlugToolsSocketEventListenInput) => {
      expect(input).toMatchObject({
        eventName: "client:custom.status.changed",
        listenTimeoutMs: 5000,
        ackTimeoutMs: 2000,
        requirePayloadSignature: false,
      });
      expect(input.session.accessToken).toBe("access-1");
      return {
        event: {
          eventId: "event-listen-1",
          eventName: input.eventName,
          emittedAt: "2026-05-11T12:00:00.000Z",
          publisher: { principalType: "client", clientId: "client-1" },
          payload: { status: "ready" },
          attachments: [
            {
              fieldName: "files",
              originalName: "invoice.txt",
              mimeType: "text/plain",
              sizeBytes: 5,
              base64: Buffer.from("hello").toString("base64"),
            },
          ],
        },
        metadata: {
          eventName: input.eventName,
          socketId: "socket-1",
          reconnectAttempt: 0,
          subscriptionCount: 1,
          payloadFrameRequestId: "event-listen-1",
        },
      };
    });
    const context = createToolContext({
      parameters: {
        resource: "tools",
        operation: "waitForSocketEvent",
        eventName: "client:custom.status.changed",
        listenTimeoutMs: 5000,
        socketAckTimeoutMs: 2000,
        binaryPropertyPrefix: "eventFile",
        requirePayloadSignature: false,
        includePlugMetadata: true,
      },
    });

    const output = await executeAdvancedPlugClientNode(context, {
      supportsSocket: true,
      credentialName: "plugDatabaseAdvancedApi",
      nodeDisplayName: "Plug Database Advanced",
      socketEventListener,
    });

    expect(output[0][0].json).toMatchObject({
      eventId: "event-listen-1",
      eventName: "client:custom.status.changed",
      payload: { status: "ready" },
      attachments: [
        {
          fieldName: "files",
          originalName: "invoice.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
        },
      ],
      __plug: {
        channel: "socket",
        operation: "waitForSocketEvent",
        socketId: "socket-1",
        payloadFrameRequestId: "event-listen-1",
        subscriptionCount: 1,
        attachmentCount: 1,
      },
    });
    expect(output[0][0].binary?.eventFile_0).toMatchObject({
      data: "binary-1",
      fileName: "invoice.txt",
      mimeType: "text/plain",
    });
    expect(context.preparedBinaries[0].buffer.toString()).toBe("hello");
    expect(context.requests).toHaveLength(1);
    expect(socketEventListener).toHaveBeenCalledOnce();
  });

  it("serializes wait Socket Event timeout when continueOnFail is enabled", async () => {
    const socketEventListener = vi.fn(async () => {
      throw new PlugError("Timed out while waiting for Plug socket event.", {
        code: "SOCKET_EVENT_LISTEN_TIMEOUT",
        statusCode: 408,
        retryable: true,
        details: {
          timeoutMs: 1,
          eventName: "client:custom.status.changed",
        },
      });
    });
    const context = createToolContext({
      continueOnFail: true,
      parameters: {
        resource: "tools",
        operation: "waitForSocketEvent",
        eventName: "client:custom.status.changed",
        listenTimeoutMs: 1,
        socketAckTimeoutMs: 2000,
        binaryPropertyPrefix: "attachment",
        requirePayloadSignature: false,
        includePlugMetadata: true,
      },
    });

    const output = await executeAdvancedPlugClientNode(context, {
      supportsSocket: true,
      credentialName: "plugDatabaseAdvancedApi",
      nodeDisplayName: "Plug Database Advanced",
      socketEventListener,
    });

    expect(output[0][0].json.error).toMatchObject({
      code: "SOCKET_EVENT_LISTEN_TIMEOUT",
      statusCode: 408,
      retryable: true,
      details: {
        timeoutMs: 1,
        eventName: "client:custom.status.changed",
      },
    });
  });

  it("rejects required socket event signatures before calling the listener when no signing key is configured", async () => {
    const socketEventListener = vi.fn();
    const context = createToolContext({
      continueOnFail: true,
      credentials: {
        payloadSigningKey: "",
        payloadSigningKeyId: "key-id-only",
      },
      parameters: {
        resource: "tools",
        operation: "waitForSocketEvent",
        eventName: "client:custom.status.changed",
        listenTimeoutMs: 5000,
        socketAckTimeoutMs: 2000,
        binaryPropertyPrefix: "attachment",
        requirePayloadSignature: true,
        includePlugMetadata: true,
      },
    });

    const output = await executeAdvancedPlugClientNode(context, {
      supportsSocket: true,
      credentialName: "plugDatabaseAdvancedApi",
      nodeDisplayName: "Plug Database Advanced",
      socketEventListener,
    });

    expect(output[0][0].json.error).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message:
        "Payload Signing Key is required when Require Payload Signature is enabled.",
    });
    expect(socketEventListener).not.toHaveBeenCalled();
  });

  it("rejects wait Socket Event listen timeouts above the operation limit", async () => {
    const socketEventListener = vi.fn();
    const context = createToolContext({
      continueOnFail: true,
      parameters: {
        resource: "tools",
        operation: "waitForSocketEvent",
        eventName: "client:custom.status.changed",
        listenTimeoutMs: 300001,
        socketAckTimeoutMs: 2000,
        binaryPropertyPrefix: "attachment",
        requirePayloadSignature: false,
        includePlugMetadata: true,
      },
    });

    const output = await executeAdvancedPlugClientNode(context, {
      supportsSocket: true,
      credentialName: "plugDatabaseAdvancedApi",
      nodeDisplayName: "Plug Database Advanced",
      socketEventListener,
    });

    expect(output[0][0].json.error).toMatchObject({
      message: "Listen Timeout (MS) must be at most 300000",
      name: "NodeOperationError",
    });
    expect(socketEventListener).not.toHaveBeenCalled();
  });

  it("marks publish results with noRecipients when the event is accepted without matched listeners", async () => {
    const context = createToolContext({
      publishBody: {
        success: true,
        eventId: "event-0",
        eventName: "client:custom.status.changed",
        recipients: 0,
        idempotencyKey: "publish-0",
        idempotentReplay: false,
        requestId: "request-0",
      },
      parameters: {
        resource: "tools",
        operation: "publishSocketEvent",
        publishChannel: "rest",
        eventName: "client:custom.status.changed",
        payloadJson: '{"status":"ready"}',
        payloadFrameCompression: "default",
        idempotencyKey: "publish-0",
        timeoutMs: 15000,
        includePlugMetadata: true,
        attachments: {},
      },
    });

    const output = await executePlugClientNode(context, {
      supportsSocket: false,
      credentialName: "plugDatabaseApi",
      nodeDisplayName: "Plug Database",
    });

    expect(output[0][0].json).toMatchObject({
      recipients: 0,
      requestId: "request-0",
      __plug: {
        recipients: 0,
        requestId: "request-0",
        deliveryStatus: "noRecipients",
      },
    });
  });

  it("renders HTML to PDF with an injected renderer and returns binary output", async () => {
    const renderer: HtmlToPdfRenderer = {
      render: vi.fn(async (input) => {
        expect(input.html).toContain("<h1>Invoice</h1>");
        expect(input.browser).toMatchObject({
          channel: "chromium",
          source: "playwright-managed",
          enableJavaScript: false,
        });
        expect(input.pdf).toMatchObject({
          format: "A4",
          printBackground: true,
          waitUntil: "domcontentloaded",
          media: "screen",
          renderDelayMs: 25,
        });
        expect(input.html).toContain("<style>body { color: red; }</style>");
        return Buffer.from("%PDF-1.7\n");
      }),
      close: vi.fn(async () => undefined),
    };
    const context = createToolContext({
      parameters: {
        html: "<!doctype html><html><body><h1>Invoice</h1></body></html>",
        css: "body { color: red; }",
        fileName: "invoice",
        outputBinaryProperty: "pdf",
        browserOptions: {
          browserChannel: "auto",
          timeoutMs: 1000,
          enableJavaScript: false,
        },
        pdfOptions: {
          format: "A4",
          printBackground: true,
          waitUntil: "domcontentloaded",
          media: "screen",
          renderDelayMs: 25,
        },
        includePlugToolsMetadata: true,
        metadataProperty: "pdfMeta",
      },
    });

    const output = await executePlugToolsPdfNode(context, {
      nodeDisplayName: "Plug Database PDF",
      renderer,
    });

    expect(output[0][0].json).toMatchObject({
      input: true,
      pdfMeta: {
        operation: "htmlToPdf",
        fileName: "invoice.pdf",
        sizeBytes: 9,
        durationMs: expect.any(Number),
        outputBinaryProperty: "pdf",
        browser: "chromium",
        browserSource: "playwright-managed",
      },
    });
    expect(output[0][0].binary?.pdf).toMatchObject({
      mimeType: "application/pdf",
      fileName: "invoice.pdf",
    });
    expect(context.preparedBinaries[0]).toMatchObject({
      fileName: "invoice.pdf",
      mimeType: "application/pdf",
    });
    expect(renderer.close).toHaveBeenCalledOnce();
  });

  it("serializes invalid PDF browser configuration when continueOnFail is enabled", async () => {
    const renderer: HtmlToPdfRenderer = {
      render: vi.fn(async () => Buffer.from("%PDF-1.7\n")),
      close: vi.fn(async () => undefined),
    };
    const context = createToolContext({
      continueOnFail: true,
      parameters: {
        html: "<html><body>Report</body></html>",
        css: "",
        fileName: "report.pdf",
        outputBinaryProperty: "data",
        browserOptions: {
          browserChannel: "safari",
        },
        pdfOptions: {},
      },
    });

    const output = await executePlugToolsPdfNode(context, {
      nodeDisplayName: "Plug Database PDF",
      renderer,
    });

    expect(renderer.render).not.toHaveBeenCalled();
    expect(output[0][0].json.error).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message: "Browser Channel must be auto, chromium, chrome, or msedge",
    });
  });

  it("generates QR codes as PNG binary data", async () => {
    const context = createToolContext({
      parameters: {
        text: "https://example.com",
        barcodeType: "qrcode",
        outputFormat: "png",
        fileName: "qr",
        outputBinaryProperty: "qr",
        renderOptions: {
          scale: 2,
          maxTextSizeBytes: 4096,
          maxOutputSizeBytes: 10000000,
        },
        advancedOptionsJson: "{}",
        includeBase64Json: true,
        base64OutputProperty: "qrBase64",
        includePlugToolsMetadata: true,
        metadataProperty: "barcodeMeta",
      },
    });

    const output = await executePlugToolsBarcodeNode(context, {
      nodeDisplayName: "Plug Database Barcode",
    });

    expect(output[0][0].json).toMatchObject({
      barcodeMeta: {
        operation: "generateCode",
        barcodeType: "qrcode",
        outputFormat: "png",
        fileName: "qr.png",
        sizeBytes: expect.any(Number),
        durationMs: expect.any(Number),
      },
      qrBase64: expect.any(String),
    });
    expect(output[0][0].binary?.qr).toMatchObject({
      mimeType: "image/png",
      fileName: "qr.png",
    });
    expect([...context.preparedBinaries[0].buffer.subarray(0, 4)]).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);
  });

  it("generates Code128 as SVG binary data", async () => {
    const context = createToolContext({
      parameters: {
        text: "0123456789",
        barcodeType: "code128",
        outputFormat: "svg",
        outputBinaryProperty: "barcode",
        renderOptions: {
          scale: 2,
          height: 10,
          includeText: true,
          textXAlign: "center",
        },
        advancedOptionsJson: "{}",
        includePlugToolsMetadata: true,
      },
    });

    const output = await executePlugToolsBarcodeNode(context, {
      nodeDisplayName: "Plug Database Barcode",
    });

    expect(output[0][0].binary?.barcode).toMatchObject({
      mimeType: "image/svg+xml",
      fileName: "barcode.svg",
    });
    expect(context.preparedBinaries[0].buffer.toString("utf8")).toContain("<svg");
  });

  it("serializes invalid barcode options when continueOnFail is enabled", async () => {
    const context = createToolContext({
      continueOnFail: true,
      parameters: {
        text: "payload",
        barcodeType: "not-a-real-code",
        outputFormat: "png",
        fileName: "bad",
        outputBinaryProperty: "data",
        renderOptions: {},
        advancedOptionsJson: "{}",
      },
    });

    const output = await executePlugToolsBarcodeNode(context, {
      nodeDisplayName: "Plug Database Barcode",
    });

    expect(output[0][0].json.error).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message:
        "Barcode Type must be qrcode, code128, ean13, ean8, upca, datamatrix, pdf417, or azteccode",
    });
  });

  it("validates numeric barcode formats before rendering", async () => {
    const context = createToolContext({
      continueOnFail: true,
      parameters: {
        text: "not-digits",
        barcodeType: "ean13",
        outputFormat: "png",
        fileName: "bad",
        outputBinaryProperty: "data",
        renderOptions: {},
        advancedOptionsJson: "{}",
      },
    });

    const output = await executePlugToolsBarcodeNode(context, {
      nodeDisplayName: "Plug Database Advanced Barcode",
    });

    expect(output[0][0].json.error).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message: "EAN-13 text must contain 12 or 13 digits",
    });
    expect(context.prepareBinaryDataMock).not.toHaveBeenCalled();
  });
});
