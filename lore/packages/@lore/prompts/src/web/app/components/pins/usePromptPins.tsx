import type { RowActionEntry } from "@alepha/ui/table";
import type { PromptResource } from "@lore/core/schemas";
import {
  type I18n,
  type PinnedPromptItem,
  currentProjectAtom,
  useRank,
} from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Bot, Copy, Play } from "lucide-react";
import { type ReactNode, useState } from "react";

import type { PromptController } from "../../../../api/controllers/PromptController.ts";
import PromptRunDialog from "../run/PromptRunDialog.tsx";
import { usePromptActions } from "../run/usePromptActions.ts";

export interface UsePromptPinsOptions {
  /**
   * Off: nothing is read. The spotlight reads only while it is open.
   */
  enabled?: boolean;
}

/**
 * The project's prompts as the pages offer them (#Q4284): which are pinned
 * on a page, with the page's or the row's item filled in, and the Copy and
 * Run that open the Prompts tab's own dialog (#Q4280).
 *
 * - An item fills the prompt's arg of its type. A prompt whose arg does not
 *   accept the item's status is not offered on that item; from the
 *   spotlight it is, and the dialog asks for the item instead.
 * - Copy with nothing left to ask copies at once; otherwise the dialog asks
 *   each missing arg in a select. A member arg left out is the caller.
 * - Run is offered with a ready Agent host and the prompt's permission.
 *
 * The read shares the Prompts tab's key, so a pin set there shows here.
 * The caller renders `dialog`.
 *
 * What fills core's `usePinnedPrompts` (`PinnedPromptsSlot`, #E175).
 */
export const usePromptPins = (options: UsePromptPinsOptions = {}) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const api = useClient<PromptController>();
  const [project] = useStore(currentProjectAtom);
  const projectId = project?.id;
  const slug = project?.slug ?? String(projectId ?? "");
  const enabled = (options.enabled ?? true) && projectId !== undefined;
  const { copy, run } = usePromptActions(projectId, slug);
  const [open, setOpen] = useState<
    | {
        prompt: PromptResource;
        mode: "copy" | "run";
        given: Record<string, string>;
      }
    | undefined
  >();

  const list = useQuery(
    {
      enabled,
      key: ["project-prompts", projectId],
      handler: () =>
        api.listPrompts({ params: { projectId: projectId as number } }),
      onError: () => {},
    },
    [api, projectId],
  );
  const hosts = useQuery(
    {
      enabled: enabled && can("host:read"),
      key: ["prompt-hosts", projectId],
      handler: () =>
        api.listPromptHosts({ params: { projectId: projectId as number } }),
      onError: () => {},
    },
    [api, projectId],
  );
  const ready = (hosts.data?.hosts ?? []).length > 0;
  const prompts = list.data?.items ?? [];

  /**
   * Whether the item may fill the prompt: its arg of that type accepts the
   * item's status, or the prompt has no such arg.
   */
  const fits = (prompt: PromptResource, item?: PinnedPromptItem) => {
    if (!item) return true;
    const arg = prompt.args.find((it) => it.type === item.type);
    if (!arg?.accepts?.length || !item.status) return true;
    return arg.accepts.includes(item.status);
  };

  const givenOf = (
    prompt: PromptResource,
    item?: PinnedPromptItem,
  ): Record<string, string> => {
    if (!item || !fits(prompt, item)) return {};
    const arg = prompt.args.find((it) => it.type === item.type);
    return arg ? { [arg.name]: item.value } : {};
  };

  const pinned = (page: string, item?: PinnedPromptItem) =>
    prompts.filter((it) => it.pins.includes(page) && fits(it, item));

  const canRun = (prompt: PromptResource) => ready && can(prompt.permission);

  const start = (
    prompt: PromptResource,
    mode: "copy" | "run",
    item?: PinnedPromptItem,
  ) => {
    const given = givenOf(prompt, item);
    const missing = prompt.args.filter(
      (arg) => !given[arg.name] && arg.type !== "member",
    );
    if (mode === "copy" && missing.length === 0) {
      void copy.run(prompt.name, given);
      return;
    }
    setOpen({ prompt, mode, given });
  };

  /**
   * A row's Agent prompts group: what is pinned on its item's view, the
   * row's item filled in. Empty when it has nothing to offer.
   */
  const rowGroup = <T,>(
    viewPage: string,
    item: PinnedPromptItem,
  ): RowActionEntry<T>[] => {
    const entries = pinned(viewPage, item);
    if (entries.length === 0) return [];
    return [
      {
        icon: Bot,
        label: tr("prompts.pinned.menu"),
        children: entries.flatMap((prompt) => [
          {
            icon: Copy,
            label: tr("prompts.pinned.copy", { args: [prompt.title] }),
            onClick: () => start(prompt, "copy", item),
          },
          ...(canRun(prompt)
            ? [
                {
                  icon: Play,
                  label: tr("prompts.pinned.run", { args: [prompt.title] }),
                  onClick: () => start(prompt, "run", item),
                },
              ]
            : []),
        ]),
      },
    ];
  };

  const dialog: ReactNode =
    projectId !== undefined && open ? (
      <PromptRunDialog
        open
        onOpenChange={(next) => !next && setOpen(undefined)}
        projectId={projectId}
        prompt={open.prompt}
        mode={open.mode}
        given={open.given}
        hosts={hosts.data?.hosts}
        busy={copy.loading || run.loading}
        onSubmit={async (body) => {
          const done =
            open.mode === "copy"
              ? await copy.run(open.prompt.name, body.args)
              : await run.run(open.prompt.name, body);
          if (done.ok) setOpen(undefined);
        }}
      />
    ) : null;

  return {
    prompts,
    pinned,
    canRun,
    start,
    rowGroup,
    dialog,
    slug,
    manage: can("prompt:manage"),
  };
};
