import { runDiscordDispatchJob } from "../apps/worker/src/jobs/discord-dispatch.ts";

const disp = await runDiscordDispatchJob();
console.log("[discord:dispatch]", disp);
