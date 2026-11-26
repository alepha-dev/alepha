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
import type { I18n, PinnedPromptsButtonProps } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { Bot, Copy, Play, Settings } from "lucide-react";
import { useEffect } from "react";

import { promptPageAtom } from "../../atoms/promptPageAtom.ts";
import { usePromptPins } from "./usePromptPins.tsx";

/**
 * The robot button of a pinnable page (#Q4284): one entry per prompt the
 * project pinned on it, each with Copy and, with a ready Agent host and the
 * prompt's permission, Run; for a member who manages prompts, a last entry
 * to Settings > Prompts. Absent when it has nothing to offer: a page no
 * built-in is pinned to by default (#Q4339), until someone pins one there.
 *
 * It also publishes the page and its item for the spotlight, which mounts
 * outside the page.
 *
 * What fills core's pins slot (`PinnedPromptsSlot`, #E175): pages render
 * core's `PinnedPromptsButton`, which draws this.
 */
const PromptPinsMenu = (props: PinnedPromptsButtonProps) => {
  const { tr } = useI18n<I18n, "en">();
  // The settings page is core's; the router is not typed for it here.
  const router = useRouter<any>();
  const [, setPage] = useStore(promptPageAtom);
  const pins = usePromptPins();
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
                  {tr("prompts.pinned.copy")}
                </DropdownMenuItem>
                {pins.mayRun(prompt) && (
                  <DropdownMenuItem
                    disabled={!pins.canRun(prompt)}
                    onClick={() => pins.start(prompt, "run", props.item)}
                  >
                    <Play />
                    {tr("prompts.pinned.run")}
                    {pins.runBlocked() && (
                      <span className="text-muted-foreground ms-auto ps-3 text-xs">
                        {pins.runBlocked()}
                      </span>
                    )}
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

export default PromptPinsMenu;
