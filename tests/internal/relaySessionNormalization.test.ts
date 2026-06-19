import { describe, expect, it } from "vitest";

import { extractServerTimings } from "../../shared/socket/relaySessionNormalization";

describe("extractServerTimings", () => {
  it("parses hub serverTimings from JSON-RPC meta", () => {
    expect(
      extractServerTimings({
        jsonrpc: "2.0",
        id: "req-1",
        result: { rows: [] },
        meta: {
          serverTimings: {
            schemaVersion: 1,
            phasesMs: {
              consumer_frame_decode_ms: 0.42,
              agent_to_hub_ms: 142.1,
            },
          },
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      phasesMs: {
        consumer_frame_decode_ms: 0.42,
        agent_to_hub_ms: 142.1,
      },
    });
  });

  it("parses nested agent_phases alongside hub serverTimings", () => {
    expect(
      extractServerTimings({
        jsonrpc: "2.0",
        id: "req-1",
        result: { rows: [] },
        meta: {
          serverTimings: {
            schemaVersion: 1,
            phasesMs: {
              agent_to_hub_ms: 180.5,
              relay_forward_to_consumer_ms: 0.06,
            },
          },
          agent_phases: {
            schema_version: 1,
            phases_ms: {
              frame_decode_ms: 0.8,
              db_execute_ms: 142.5,
              frame_encode_ms: 2.1,
            },
          },
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      phasesMs: {
        agent_to_hub_ms: 180.5,
        relay_forward_to_consumer_ms: 0.06,
      },
      agentPhases: {
        schemaVersion: 1,
        phasesMs: {
          frame_decode_ms: 0.8,
          db_execute_ms: 142.5,
          frame_encode_ms: 2.1,
        },
      },
    });
  });

  it("parses hub-merged agent_* phases in phasesMs", () => {
    expect(
      extractServerTimings({
        meta: {
          serverTimings: {
            schemaVersion: 1,
            phasesMs: {
              agent_to_hub_ms: 200,
              agent_db_execute_ms: 142.5,
              agent_queue_wait_ms: 5,
            },
          },
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      phasesMs: {
        agent_to_hub_ms: 200,
        agent_db_execute_ms: 142.5,
        agent_queue_wait_ms: 5,
      },
    });
  });

  it("parses top-level serverTimings on agents:command_response wire", () => {
    expect(
      extractServerTimings({
        success: true,
        requestId: "hub-1",
        serverTimings: {
          schemaVersion: 1,
          phasesMs: {
            emit_to_socket_ms: 0.07,
          },
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      phasesMs: {
        emit_to_socket_ms: 0.07,
      },
    });
  });

  it("parses agent_phases-only meta when hub timings are absent", () => {
    expect(
      extractServerTimings({
        meta: {
          agent_phases: {
            schema_version: 1,
            phases_ms: {
              db_execute_ms: 99.2,
            },
          },
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      phasesMs: {},
      agentPhases: {
        schemaVersion: 1,
        phasesMs: {
          db_execute_ms: 99.2,
        },
      },
    });
  });

  it("parses wrapped response.meta serverTimings", () => {
    expect(
      extractServerTimings({
        response: {
          meta: {
            serverTimings: {
              schemaVersion: 2,
              phasesMs: {
                pending_resolve_ms: 0.18,
              },
            },
          },
        },
      }),
    ).toEqual({
      schemaVersion: 2,
      phasesMs: {
        pending_resolve_ms: 0.18,
      },
    });
  });

  it("returns undefined for non-timing payloads", () => {
    expect(extractServerTimings(null)).toBeUndefined();
    expect(extractServerTimings({ meta: { trace_id: "hidden" } })).toBeUndefined();
    expect(
      extractServerTimings({
        meta: {
          serverTimings: {
            schemaVersion: 1,
            phasesMs: {},
          },
        },
      }),
    ).toBeUndefined();
  });
});
