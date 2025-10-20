import { parentPort, workerData } from "node:worker_threads";
import { $env, $hook, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { $thread } from "../descriptors/$thread.ts";

interface ThreadMessage<T = any> {
  id: string;
  type: "execute" | "response" | "error" | "ready";
  data?: T;
  error?: string;
}

export class ThreadProvider {
  protected readonly log = $logger();
  protected readonly env = $env(
    t.object({
      ALEPHA_WORKER: t.optional(t.text()),
    }),
  );

  protected readonly ready = $hook({
    on: "ready",
    handler: async (alepha) => {
      const worker = this.env.ALEPHA_WORKER;
      if (!worker) {
        return;
      }

      const threads = alepha.descriptors($thread);
      const threadDescriptor = threads.find((thread) => thread.name === worker);

      if (!threadDescriptor) {
        this.log.error(`Thread not found: ${worker}`);
        return;
      }

      this.log.info(`Thread ready: ${threadDescriptor.name}`);

      // Use the message channel port from worker data if available, fallback to parentPort
      const communicationPort = workerData?.port || parentPort;

      if (!communicationPort) {
        this.log.error("No communication port available");
        return;
      }

      // Set up message handling
      communicationPort.on("message", async (message: ThreadMessage) => {
        if (message.type === "execute") {
          try {
            this.log.debug(
              `Executing thread handler: ${threadDescriptor.name}`,
            );
            const result = await threadDescriptor.options.handler();

            communicationPort.postMessage({
              id: message.id,
              type: "response",
              data: result,
            } as ThreadMessage);
          } catch (error) {
            this.log.error(`Thread execution error: ${error}`);

            communicationPort.postMessage({
              id: message.id,
              type: "error",
              error: error instanceof Error ? error.message : String(error),
            } as ThreadMessage);
          }
        }
      });

      // Signal that the worker is ready
      communicationPort.postMessage({ type: "ready" } as ThreadMessage);
    },
  });

  public static async cleanup(): Promise<void> {
    if (parentPort) {
      parentPort.removeAllListeners();
    }
  }
}
