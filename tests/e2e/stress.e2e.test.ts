import { getPlugE2EConfig } from "./helpers/e2eEnv";
import { registerPlugStressLiveE2E } from "./helpers/stressLiveSuite";

registerPlugStressLiveE2E(getPlugE2EConfig());
