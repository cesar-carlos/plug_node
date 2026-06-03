import type { PlugSocketExecutor } from "../../generated/shared/n8n/plugClientExecution";
import { createRelaySocketCommandExecutor } from "./relaySocketExecutionManager";

const defaultRelayExecutor = createRelaySocketCommandExecutor();

export const executeSocketCommand: PlugSocketExecutor = (input) =>
  defaultRelayExecutor.execute(input);

export const createRelaySocketExecutorForNode = createRelaySocketCommandExecutor;
