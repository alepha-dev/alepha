import { MemoryEventLogProvider } from "../providers/MemoryEventLogProvider.ts";
import { eventLogConformance } from "./eventLogConformance.ts";

eventLogConformance("memory", async (logs) => {
  const provider = new MemoryEventLogProvider();
  for (const log of logs) provider.register(log);
  return provider;
});
