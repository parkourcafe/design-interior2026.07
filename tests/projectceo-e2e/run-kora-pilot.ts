import { runKoraPilotScenario } from "./kora-pilot-harness";

process.stdout.write(`${JSON.stringify(runKoraPilotScenario(), null, 2)}\n`);
