import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const [agentArg, serverArg, dartArg] = process.argv.slice(2);
if (!agentArg || !serverArg || !dartArg)
  throw Error(
    "Usage: node scripts/verify-native-availability.mjs <current-agent> <hub> <dart> [--historical-root <v1.8.6>] [--prepare-only]",
  );
const agent = resolve(agentArg),
  server = resolve(serverArg),
  dart = resolve(dartArg);
const historyIndex = process.argv.indexOf("--historical-root");
const historical = historyIndex < 0 ? undefined : resolve(process.argv[historyIndex + 1]);
const scratch = resolve(
  historical ? "tmp/native-node-availability-historical" : "tmp/native-node-availability",
);
mkdirSync(scratch, { recursive: true });
const read = (path) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const replace = (source, from, to) => {
  if (!source.includes(from)) throw Error(`Fixture shape changed: ${from.slice(0, 70)}`);
  return source.replace(from, to);
};
const fixtureRoot = join(agent, "tool/homologation");
if (historical) {
  writeFileSync(
    join(scratch, "historical_test.dart"),
    read(join(server, "tool/homologation/agent_1_8_6_availability_test.dart")),
  );
}
let controller = read(join(fixtureRoot, "action_io_hub_smoke.mjs"));
controller = replace(
  controller,
  "new URL('../../contracts/action_io_shared_fixtures.json', import.meta.url)",
  JSON.stringify(join(agent, "contracts/action_io_shared_fixtures.json")),
);
controller = replace(
  controller,
  "fileURLToPath(new URL('../../', import.meta.url))",
  JSON.stringify(historical ?? agent),
);
controller = replace(
  controller,
  "'test/infrastructure/actions/action_io_run_test.dart'",
  JSON.stringify(
    historical
      ? join(scratch, "historical_test.dart")
      : join(scratch, "availability_test.dart"),
  ),
);
controller = replace(
  controller,
  "NODE_ENV: 'test',",
  `PLUG_NODE_HISTORICAL: '${Boolean(historical)}', PLUG_NODE_BUILT: ${JSON.stringify(resolve("packages/n8n-nodes-plug-database/dist/generated/shared"))}, NODE_ENV: 'test',`,
);
controller = replace(
  controller,
  "console.log('PASS: TypeScript reference client via REST, socket and relay -> authenticated hub -> native Windows process, exact bytes and terminal deduplication.');",
  `console.log('PASS: compiled node availability errors over REST, socket and relay (${historical ? "historical agent" : "current agent"}).');`,
);
if (historical)
  controller = replace(
    controller,
    "console.log(`PASS: ${callerTransport} caller -> authenticated hub -> agent RPC -> native Windows process, binary output and terminal replay.`);",
    "console.log('PASS: historical transport registered and reached readiness before capability checks.');",
  );
controller = replace(
  controller,
  "writeFileSync(join(root, 'hub-stop'), '');",
  `writeFileSync(${JSON.stringify(join(scratch, "availability-report.json"))}, readFileSync(join(root, 'availability-report.json')));\n  writeFileSync(join(root, 'hub-stop'), '');`,
);
writeFileSync(join(scratch, "action_io_hub_smoke.mjs"), controller);
let hub = read(join(fixtureRoot, "action_io_hub_fixture.cts"));
hub = replace(
  hub,
  "const server = await createTestServer();",
  'const server = await createTestServer();\n  const availabilityDispatches = new Map<string, number>();\n  const {decodePayloadFrame} = requireServer("./src/shared/utils/payload_frame");',
);
hub = replace(
  hub,
  'const marker = join(root, "delay-next-rpc");',
  'if (event === "rpc:request") { const decoded = decodePayloadFrame(args[0]); if (!decoded.ok || typeof decoded.value.data?.method !== "string") throw Error("Unexpected native dispatcher frame"); const method = decoded.value.data.method; availabilityDispatches.set(method, (availabilityDispatches.get(method) ?? 0) + 1); }\n      const marker = join(root, "delay-next-rpc");',
);
hub = replace(
  hub,
  "await verifyReferenceClient({",
  "await verifyReferenceClient({ root, dispatchCount: (method: string) => availabilityDispatches.get(method) ?? 0,",
);
// The positive harness runs the echo CLI separately. The availability suite
// measures refusals and zero process starts, including on agents without I/O.
hub = replace(
  hub,
  'for (const mode of ["rest", "socket"]) {',
  "for (const mode of [] as string[]) {",
);
writeFileSync(join(scratch, "action_io_hub_fixture.cts"), hub);
writeFileSync(
  join(scratch, "action_io_reference_fixture.cts"),
  read(resolve("scripts/availability-native-client.cts")),
);

// Copy the native test and helper; all relative imports resolve to the original
// checkout except this controlled helper. No sibling source/configuration edits.
function absoluteImports(source, origin) {
  return source.replace(/(import|export) '([^']+)'/g, (all, keyword, path) => {
    if (/^[a-z]+:/.test(path)) return all;
    const target = /^action_io_hub_.*\.dart$/.test(basename(path))
      ? join(scratch, basename(path))
      : resolve(dirname(origin), path);
    return `${keyword} '${pathToFileURL(target).href}'`;
  });
}
for (const name of readdirSync(join(agent, "test/helpers"))) {
  if (/^action_io_hub_.*\.dart$/.test(name)) {
    const origin = join(agent, "test/helpers", name);
    writeFileSync(join(scratch, name), absoluteImports(read(origin), origin));
  }
}
const testPath = join(agent, "test/infrastructure/actions/action_io_run_test.dart");
let test = absoluteImports(read(testPath), testPath);
// The original process counter proves failed requests did not spawn executions.
test = replace(
  test,
  "if (hub != null) await hub.verifyReferenceClient(intent.actionId);",
  "if (hub != null) { final startsBeforeAvailability = processes.starts; await hub.verifyReferenceClient(intent.actionId); expect(processes.starts, startsBeforeAvailability); }",
);
writeFileSync(join(scratch, "availability_test.dart"), test);
const helperPath = join(agent, "test/helpers/action_io_hub_fixture.dart");
let helper = absoluteImports(read(helperPath), helperPath);
helper = replace(
  helper,
  "final Map<String, dynamic> _manifest;",
  "final Map<String, dynamic> _manifest;\n  String _availabilityMode = 'enabled';\n  Future<void> Function()? _reconfigure;\n  Future<void> Function()? _disableLocal;",
);
helper = replace(
  helper,
  "final flags = FeatureFlags(",
  "_reconfigure = () => connect(run: run, validate: validate, catalog: catalog, access: access, contract: contract);\n    final flags = FeatureFlags(",
);
helper = replace(
  helper,
  "'feature_enable_action_io': true,",
  "'feature_enable_action_io': _availabilityMode != 'disabled',",
);
helper = replace(
  helper,
  "faithfulIoAvailable: () => true,",
  "faithfulIoAvailable: () => flags.enableActionIo,",
);
helper = replace(
  helper,
  "final database = _UnusedDatabase();",
  "_disableLocal = () => flags.setEnableActionIo(false);\n    final database = _UnusedDatabase();",
);
helper = replace(
  helper,
  "enabled: () => true, access: access",
  "enabled: () => flags.enableActionIo, access: access",
);
helper = replace(
  helper,
  "ActionIoRpcHandler(method, contract:",
  "if (_availabilityMode != 'missing-handler' || method != 'agent.action.getExecution')\n        ActionIoRpcHandler(method, contract:",
);
helper = replace(
  helper,
  "while (!result.existsSync()) {",
  `while (!result.existsSync()) {
        final control = File(p.join(fixtureRoot, 'availability-control.json'));
        if (control.existsSync()) {
          final command = jsonDecode(await control.readAsString()) as Map<String, dynamic>;
          await control.delete();
          final mode = command['mode'] as String;
          if (mode == 'local-disabled') { await _disableLocal!(); }
          else {
            if (!['enabled', 'disabled', 'missing-handler'].contains(mode)) throw StateError('Invalid fixture mode');
            await _transport?.disconnect();
            _availabilityMode = mode;
            await _reconfigure!();
          }
          final next = File(p.join(fixtureRoot, 'availability-control-result.next'));
          await next.writeAsString(jsonEncode({'mode': mode}), flush: true);
          await next.rename(p.join(fixtureRoot, 'availability-control-result.json'));
        }`,
);
writeFileSync(join(scratch, "action_io_hub_fixture.dart"), helper);
if (process.argv.includes("--prepare-only")) {
  console.log(`Prepared isolated native availability fixtures: ${scratch}`);
} else {
  if (!existsSync(dart)) throw Error("Explicit Flutter Dart executable required");
  const result = spawnSync(
    process.execPath,
    [join(scratch, "action_io_hub_smoke.mjs"), server, "--native", dart],
    { stdio: "inherit", windowsHide: true, timeout: 300000 },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
