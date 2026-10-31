import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

// Reuse the agent's isolated controller without modifying either sibling checkout.
const agent = resolve(process.argv[2]);
const server = resolve(process.argv[3]);
const dart = resolve(process.argv[4]);
const scratch = resolve("tmp/native-node-action-io");
mkdirSync(scratch, { recursive: true });
const built = resolve("packages/n8n-nodes-plug-database/dist/generated/shared");
const fixtureRoot = join(agent, "tool/homologation");
let controller = readFileSync(join(fixtureRoot, "action_io_hub_smoke.mjs"), "utf8");
controller = controller.replace(
  "TypeScript reference client via",
  "Built plug_node client via",
);
controller = controller
  .replace(
    "new URL('../../contracts/action_io_shared_fixtures.json', import.meta.url)",
    JSON.stringify(join(agent, "contracts/action_io_shared_fixtures.json")),
  )
  .replace("fileURLToPath(new URL('../../', import.meta.url))", JSON.stringify(agent));
writeFileSync(join(scratch, "action_io_hub_smoke.mjs"), controller);
writeFileSync(
  join(scratch, "action_io_hub_fixture.cts"),
  readFileSync(join(fixtureRoot, "action_io_hub_fixture.cts")),
);
let reference = readFileSync(
  join(fixtureRoot, "action_io_reference_fixture.cts"),
  "utf8",
).replaceAll("\r\n", "\n");
reference = reference
  .replace(
    'options.requireServer(\n    "./docs/snippets/action_io_reference_client",\n  )',
    `require(${JSON.stringify(join(scratch, "node-client.cjs"))})`,
  )
  .replace(
    'options.requireServer(\n    "./docs/snippets/action_io_rest_transport",\n  )',
    `require(${JSON.stringify(join(built, "rest/actionIoTransport.js"))})`,
  )
  .replace(
    'options.requireServer(\n    "./docs/snippets/action_io_socket_transport",\n  )',
    `require(${JSON.stringify(join(built, "socket/actionIoTransport.js"))})`,
  );
if (reference.includes('"./docs/snippets/action_io_'))
  throw new Error("Reference fixture import shape changed; inspect before running");
writeFileSync(join(scratch, "action_io_reference_fixture.cts"), reference);
writeFileSync(
  join(scratch, "node-client.cjs"),
  `
const {callActionIo}=require(${JSON.stringify(join(built, "contracts/actionIo/client.js"))});
exports.ActionIoReferenceClient=class {
 constructor(transport,credential){this.transport=transport;this.credential=credential;}
 call(op,p){return callActionIo(this.transport,op,p,this.credential());}
 async *listAvailable(pageSize=20){
   const seen=new Set(); let cursor;
   do {
     const page=await this.call('listAvailable',{page_size:pageSize,...(cursor?{cursor}:{})});
     cursor=page.next_cursor;
     if(cursor && seen.has(cursor))throw Error('Catalog cursor repeated');
     if(cursor)seen.add(cursor);
     yield* page.actions;
   } while(cursor);
 }
 async availableActions(candidates){
   const available=[];
   for(const candidate of candidates){
     try {
       const validation=await this.call('validateRun',{action_id:candidate.actionId,idempotency_key:require('node:crypto').randomUUID(),...(candidate.triggerId?{trigger_id:candidate.triggerId}:{}),io:{version:1,mode:'faithful',close_input:false}});
       if(validation.valid===true)available.push(candidate);
     }catch(error){if(error.code!=='ACTION_IO_UNAUTHORIZED'||error.details?.reason!=='scope_or_action_denied')throw error;}
   }
   return available;
 }
 run(action_id,idempotency_key,o={}){if(o.initial && o.initial.byteLength>65536)throw Error('INPUT_TOO_LARGE');return this.call('run',{action_id,idempotency_key,...(o.triggerId?{trigger_id:o.triggerId}:{}),io:{version:1,mode:'faithful',close_input:o.closeInput??false,...(o.initial===undefined?{}:{initial_input_base64:Buffer.from(o.initial).toString('base64')})}});}
 sendInput(execution_id,message_id,sequence,b){if(b.byteLength>65536)throw Error('INPUT_TOO_LARGE');return this.call('sendInput',{execution_id,message_id,sequence,data_base64:Buffer.from(b).toString('base64')});}
 closeInput(execution_id,message_id,sequence){return this.call('closeInput',{execution_id,message_id,sequence});}
 getInputStatus(execution_id,message_id){return this.call('getInputStatus',{execution_id,message_id});}
 findExecution(action_id,idempotency_key){return this.call('findExecution',{action_id,idempotency_key});}
 getExecution(execution_id){return this.call('getExecution',{execution_id});}
 readIo(execution_id,after_sequence,wait_ms=20000){return this.call('readIo',{execution_id,after_sequence,wait_ms,max_bytes:262144});}
};`,
);
console.log(
  "Running node client against isolated native agent; no production configuration is loaded.",
);
const result = spawnSync(
  process.execPath,
  [join(scratch, "action_io_hub_smoke.mjs"), server, "--native", dart],
  { stdio: "inherit", windowsHide: true, timeout: 300000 },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
