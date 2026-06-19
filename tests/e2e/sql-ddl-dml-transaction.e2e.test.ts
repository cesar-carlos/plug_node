import { getPlugE2EConfig } from "./helpers/e2eEnv";
import { registerPlugSqlDdlDmlTransactionLiveE2E } from "./helpers/sqlDdlDmlTransactionLiveSuite";

const e2eConfig = getPlugE2EConfig();

registerPlugSqlDdlDmlTransactionLiveE2E("rest", e2eConfig);
registerPlugSqlDdlDmlTransactionLiveE2E("socket", e2eConfig);
