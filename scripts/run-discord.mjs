import { runDiscordEnqueueJob } from "../apps/worker/src/jobs/discord-enqueue.ts";
import { runDiscordDispatchJob } from "../apps/worker/src/jobs/discord-dispatch.ts";

const enq = await runDiscordEnqueueJob();
console.log("[discord:enqueue]", enq);
const disp = await runDiscordDispatchJob();
console.log("[discord:dispatch]", disp);
