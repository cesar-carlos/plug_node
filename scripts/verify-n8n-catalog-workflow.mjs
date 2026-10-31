import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const [agentArg, hubArg, dartArg, container] = process.argv.slice(2);
const tcpReset = container === "--load-rest-reset";
const load = container === "--load" || tcpReset;
if (
  !agentArg ||
  !hubArg ||
  !dartArg ||
  (!load && !/^plug-catalog-n8n-[a-z0-9-]+$/.test(container ?? ""))
)
  throw Error(
    "Expected isolated agent checkout, Hub checkout, Flutter dart.exe and disposable plug-catalog-n8n-* container",
  );
const agent = resolve(agentArg),
  hub = resolve(hubArg),
  scratch = resolve(load ? "tmp/native-load" : "tmp/n8n-workflow-harness");
mkdirSync(scratch, { recursive: true });
const source = (path) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
function replace(text, needle, replacement) {
  if (!text.includes(needle))
    throw Error(`Fixture shape changed: ${needle.slice(0, 55)}`);
  return text.replace(needle, () => replacement);
}
const testFile = join(agent, "test/infrastructure/actions/action_io_run_test.dart");
let test = source(testFile).replace(
  /import '(\.[^']+)'/g,
  (_, p) => `import '${pathToFileURL(resolve(dirname(testFile), p)).href}'`,
);
test =
  "import 'package:plug_agente/application/use_cases/create_client_token.dart';\nimport 'package:plug_agente/domain/entities/client_token_create_request.dart';\n" +
  test;
test = replace(
  test,
  "if (hub != null) await hub.verifyReferenceClient(intent.actionId);",
  `if (hub != null) {
        Future<String> grant(String name, List<String> scopes, {List<String>? ids}) async {
          final created=(await CreateClientToken(credentials!.repository).createWithIdentity(ClientTokenCreateRequest(
            clientId: 'catalog-workflow-$name', agentId: hub.agentId, name: name, allTables:false,allViews:false,rules:const [],
            payload:{'agent_action_scopes':scopes, if(ids!=null) 'agent_actions':{'action_ids':ids}},
          ))).getOrThrow(); return created.tokenValue;
        }
        final grants=File('\${hub.fixtureRoot}/workflow-grants.json');
        final pending=File('\${hub.fixtureRoot}/reference-request.next');
        final result=File('\${hub.fixtureRoot}/reference-result.json');
        try {
          await grants.writeAsString(jsonEncode({'empty':await grant('empty',['agent_actions.list','agent_actions.run','agent_actions.io'],ids:['not-in-fixture']), 'denied':await grant('denied',['agent_actions.run'])}),flush:true);
          await pending.writeAsString(jsonEncode({'format':'action-io-reference-v1','actionId':intent.actionId,'credential':hub.credential}),flush:true);
          await pending.rename('\${hub.fixtureRoot}/reference-request.json');
          final deadline=DateTime.now().add(const Duration(seconds:150));
          while(!result.existsSync()) { if(DateTime.now().isAfter(deadline)) throw StateError('Workflow deadline exceeded'); await Future<void>.delayed(const Duration(milliseconds:100)); }
          expect(jsonDecode(await result.readAsString())['success'],true);
        } finally {if(grants.existsSync()) await grants.delete();}
      }`,
);
const generatedTest = join(scratch, "n8n_catalog_test.dart");
if (load) {
  test = replace(
    test,
    "final grants=File(",
    "final beforeLoad = processes.starts; await File('${hub.fixtureRoot}/agent.pid').writeAsString(pid.toString()); final grants=File(",
  );
  test = replace(
    test,
    "['success'],true);",
    `['success'],true); expect(processes.starts - beforeLoad, ${tcpReset ? 1 : 2}); return;`,
  );
  // End this load-only case after checking native starts. The fixture's finally
  // still closes the Hub, supervisor, journal and databases.
  const pidPath = join(scratch, "child.pid").replaceAll("\\", "/");
  test = replace(
    test,
    "r'$i=[Console]",
    `r'[IO.File]::WriteAllText("${pidPath}",$PID.ToString());$i=[Console]`,
  );
}
const restart = process.argv[6] === "--restart";
const recovery = restart || process.argv[6] === "--recovery";
if (restart) test = replace(test, "seconds:150", "seconds:420");
if (recovery) {
  test = replace(
    test,
    "final grants=File(",
    "final startsBeforeWorkflow = processes.starts; final grants=File(",
  );
  test = replace(
    test,
    "['success'],true);",
    "['success'],true); expect(processes.starts - startsBeforeWorkflow, 3);",
  );
}
writeFileSync(generatedTest, test);
const fixtures = join(agent, "tool/homologation");
let companion = source(join(fixtures, "action_io_hub_fixture.cts"));
companion = replace(
  companion,
  'from "./action_io_reference_fixture.cts"',
  `from ${JSON.stringify(resolve(load ? "scripts/fixtures/native-load-client.cjs" : "scripts/n8n-catalog-workflow-client.cjs"))}`,
);
companion = replace(
  companion,
  "await verifyReferenceClient({",
  "await verifyReferenceClient({ email:session.client.email, password:session.client.password,",
);
const echoStart = companion.indexOf('          for (const mode of ["rest", "socket"])');
const publish = companion.indexOf("          publishReferenceResult({", echoStart);
if (echoStart < 0 || publish < 0) throw Error("Hub companion changed");
companion = companion.slice(0, echoStart) + companion.slice(publish);
companion = replace(
  companion,
  'transports: ["rest", "socket", "relay"],',
  "workflowVerified: true,",
);
writeFileSync(join(scratch, "action_io_hub_fixture.cts"), companion);
let controller = source(join(fixtures, "action_io_hub_smoke.mjs"));
controller = replace(
  controller,
  "new URL('../../contracts/action_io_shared_fixtures.json', import.meta.url)",
  JSON.stringify(join(agent, "contracts/action_io_shared_fixtures.json")),
);
controller = replace(
  controller,
  "fileURLToPath(new URL('../../', import.meta.url))",
  JSON.stringify(agent),
);
controller = replace(
  controller,
  "'test/infrastructure/actions/action_io_run_test.dart'",
  JSON.stringify(generatedTest),
);
controller = replace(
  controller,
  "NODE_ENV: 'test',",
  `PLUG_WORKFLOW_PROXY:${JSON.stringify(resolve("scripts/fixtures/catalog-loopback-proxy.cjs"))}, PLUG_FIXTURE_OPENSSL:${JSON.stringify(process.env.PLUG_FIXTURE_OPENSSL ?? "C:/Program Files/Git/usr/bin/openssl.exe")}, PLUG_WORKFLOW_FILE:${JSON.stringify(resolve("docs/socket/examples/catalog-acceptance-workflow.json"))}, PLUG_WORKFLOW_REPORT:${JSON.stringify(join(scratch, "report.json"))}, PLUG_WORKFLOW_CONTAINER:${JSON.stringify(container)}, NODE_ENV:'test',`,
);
controller = replace(
  controller,
  `JSON.stringify(reference.transports) !== '["rest","socket","relay"]'`,
  "reference.workflowVerified !== true",
);
controller = replace(
  controller,
  "TypeScript reference client via REST, socket and relay -> authenticated hub -> native Windows process, exact bytes and terminal deduplication.",
  "n8n CLI workflow -> authenticated Hub -> native agent; pagination, empty allowlist and denied scope.",
);
const entry = join(scratch, "action_io_hub_smoke.mjs");
if (tcpReset)
  controller = replace(
    controller,
    "PLUG_WORKFLOW_PROXY:",
    "PLUG_LOAD_TCP_RESET:'1', PLUG_WORKFLOW_PROXY:",
  );
if (load)
  controller = replace(
    controller,
    "n8n CLI workflow -> authenticated Hub -> native agent; pagination, empty allowlist and denied scope.",
    tcpReset
      ? "REST reader TCP reset under load, one native start."
      : "separate Node load client -> authenticated Hub -> native agent, REST and Socket.",
  );
if (load) controller = replace(controller, "'--timeout', '2m'", "'--timeout', '4m'");
if (process.argv[6] === "--actions" || recovery) {
  controller = replace(
    controller,
    "PLUG_WORKFLOW_PROXY:",
    `PLUG_ACTION_WORKFLOW:'${restart ? "restart" : recovery ? "recovery" : "1"}', PLUG_WORKFLOW_PROXY:`,
  );
  controller = replace(
    controller,
    "pagination, empty allowlist and denied scope.",
    recovery
      ? "remote action recovery via REST, Socket and relay; three native starts."
      : "remote action input, output and cancellation via REST, Socket and relay.",
  );
  if (recovery)
    controller = replace(
      controller,
      "'--timeout', '2m'",
      restart ? "'--timeout', '8m'" : "'--timeout', '4m'",
    );
}
writeFileSync(entry, controller);
const run = spawnSync(process.execPath, [entry, hub, "--native", resolve(dartArg)], {
  stdio: "inherit",
  windowsHide: true,
  timeout: restart ? 540000 : 300000,
});
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
