import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient } from "alepha/react";
import { useState } from "react";

import type { EstateCommandController } from "@/api/controllers/EstateCommandController.ts";
import type { Estate } from "@/api/entities/estates.ts";
import type { EstateCommandResource } from "@/api/schemas/estateCommandResourceSchema.ts";

/**
 * What this console may ask for: one instance, named by its pair.
 *
 * ⚠️ Not `logs`, which carries its own bounded ask and is driven by
 * `BayLogTail`; and not `deploy`, which epic #E1 owns. The vocabulary is
 * closed on both sides, and this is the subset the buttons speak.
 */
export interface BayCommandBody {
  kind: "restart" | "stop" | "start" | "backup";
  app: string;
  environment: string;
}

/**
 * Queue one command and follow it to its own conclusion.
 *
 * ⚠️ **A command is queued, not performed, and the UI must say the true thing
 * at each step.** A button that flips to success on the HTTP 200 is lying: the
 * 200 means a row was written. So this holds the command's own state -
 * `pending`, `sent`, `running` with a step, then `done` or `failed` with a
 * reason - and polls until it is terminal or the poll window runs out.
 *
 * ⚠️ **A `pending` command is not a failure**, it is an offline machine. The
 * two read very differently and the caller says so in its own words; this only
 * reports which.
 *
 * The failure reason is carried VERBATIM from the machine's ack. It is the
 * sentence the executor wrote about the host, and paraphrasing it would lose
 * the one piece of information a person needs.
 */
export const useBayCommand = (estate: Estate | undefined) => {
  const commandApi = useClient<EstateCommandController>();
  const toaster = useToast();
  const [command, setCommand] = useState<EstateCommandResource | undefined>();
  const [busy, setBusy] = useState(false);

  const run = async (body: BayCommandBody) => {
    if (!estate || busy) {
      return;
    }
    setBusy(true);
    setCommand(undefined);
    try {
      let current = await commandApi.enqueueEstateCommand({
        params: { estateId: estate.id },
        body,
      });
      setCommand(current);

      // Followed rather than assumed. The machine acks over its own
      // connection, so the row is where the outcome appears.
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        if (current.status === "done" || current.status === "failed") {
          return current;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        const listed = await commandApi.listEstateCommands({
          params: { estateId: estate.id },
        });
        const found = listed.items.find((item) => item.id === current.id);
        if (found) {
          current = found;
          setCommand(found);
        }
      }
      return current;
    } catch (error) {
      // A refusal at enqueue (a deploy switch, an offline machine for the
      // verbs that refuse) is the server's sentence and is shown as it is.
      toaster.error(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  return { command, busy, run, clear: () => setCommand(undefined) };
};

/** The gap between two reads of the queue. */
const POLL_MS = 2000;
/**
 * Enough polls to outlast the longest verb this console queues (`backup`, at
 * 900 s) without following one forever: past this the Commands tab is where
 * the outcome is read.
 */
const ATTEMPTS = 30;
