import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@alepha/ui";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Bot, Copy, Play, Settings } from "lucide-react";
import { useEffect } from "react";

import { promptPageAtom } from "../../../../atoms/promptPageAtom.ts";
import type { I18n } from "../../../../services/I18n.ts";
import type { PinnedPromptItem } from "./pinnedPromptItemSchema.ts";
import { usePinnedPrompts } from "./usePinnedPrompts.tsx";

export interface PinnedPromptsButtonProps {
  /**
   * The pinnable page's key (`quest`, `epics`, ...).
   */
  page: string;
  /**
   * The item the page gives, which fills the prompt's arg of its type.
   */
  item?: PinnedPromptItem;
  /**
   * Off: the page is not told to the spotlight, for a list whose open
   * item's own button tells it.
   */
  publish?: boolean;
}

/**
 * The robot button of a pinnable page (#Q4284): one entry per prompt the
 * project pinned on it, each with Copy and, with a ready Agent host and the
 * prompt's permission, Run; for a member who manages prompts, a last entry
 * to Settings > Prompts. Absent when it has nothing to offer: a new project
 * pins nothing, so it shows no button until someone pins.
 *
 * It also publishes the page and its item for the spotlight, which mounts
 * outside the page.
 */
const PinnedPromptsButton = (props: PinnedPromptsButtonProps) => {
  const { tr } = useI18n<I18n, "en">();
  // The settings page is core's; the router is not typed for it here.
  const router = useRouter<any>();
  const [, setPage] = useStore(promptPageAtom);
  const pins = usePinnedPrompts();
  const entries = pins.pinned(props.page, props.item);
  const itemKey = props.item
    ? `${props.item.type}:${props.item.value}:${props.item.status ?? ""}`
    : "";

  const publish = props.publish ?? true;
  useEffect(() => {
    if (!publish) return;
    setPage({
      page: props.page,
      ...(props.item ? { item: props.item } : {}),
    });
    return () => setPage({});
    // The item by its key: a new object each render is the same item.
  }, [props.page, itemKey, publish, setPage]);

  if (entries.length === 0) return pins.dialog;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="minimal"
              size="icon"
              aria-label={tr("prompts.pinned.menu")}
              title={tr("prompts.pinned.menu")}
              data-testid="pinned-prompts"
            />
          }
        >
          <Bot className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {entries.map((prompt) => (
            <DropdownMenuSub key={prompt.name}>
              <DropdownMenuSubTrigger>{prompt.title}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onClick={() => pins.start(prompt, "copy", props.item)}
                >
                  <Copy />
                  {tr("prompts.copy")}
                </DropdownMenuItem>
                {pins.canRun(prompt) && (
                  <DropdownMenuItem
                    onClick={() => pins.start(prompt, "run", props.item)}
                  >
                    <Play />
                    {tr("prompts.run")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
          {pins.manage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  void router.push("projectSettingsPrompts", {
                    params: { projectSlug: pins.slug },
                  })
                }
              >
                <Settings />
                {tr("prompts.pinned.settings")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {pins.dialog}
    </>
  );
};

export default PinnedPromptsButton;
