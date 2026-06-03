import { getPlugE2EConfig } from "./helpers/e2eEnv";
import { registerPlugSqlBatchLiveE2E } from "./helpers/sqlBatchLiveSuite";
import { registerPlugSqlCancelLiveE2E } from "./helpers/sqlCancelLiveSuite";
import { registerPlugSqlHubOptionsLiveE2E } from "./helpers/sqlHubOptionsLiveSuite";
import { registerPlugSqlLiveE2E } from "./helpers/sqlLiveSuite";

const e2eConfig = getPlugE2EConfig();

registerPlugSqlLiveE2E("rest", e2eConfig);
registerPlugSqlBatchLiveE2E("rest", e2eConfig);
registerPlugSqlHubOptionsLiveE2E("rest", e2eConfig);
registerPlugSqlCancelLiveE2E("rest", e2eConfig);
