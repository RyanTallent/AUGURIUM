import { runDiscordDispatchJob } from "../jobs/discord-dispatch.js";
import { runDiscordEnqueueJob } from "../jobs/discord-enqueue.js";

/** Phase E — Discord intelligence (advisory only, no execution). */
export async function processDiscordNotifications(): Promise<number> {
  const enq = await runDiscordEnqueueJob();
  const disp = await runDiscordDispatchJob();
  console.log("[discord] enqueue", enq, "dispatch", disp);
  return enq.queued + disp.sent;
}

export async function dispatchDiscordEvents(): Promise<number> {
  const disp = await runDiscordDispatchJob();
  return disp.sent;
}
