import { Kbd, KbdGroup } from "@alepha/ui/components/ui/kbd";
import { cn } from "@alepha/ui/lib/utils";
import { useStore } from "alepha/react";
import { SearchIcon } from "lucide-react";

import { navPaletteAtom } from "../navPaletteAtom.ts";
import { useShortcutModifier } from "../useShortcutModifier.ts";

export interface NavPaletteFieldProps {
  className?: string;
}

/**
 * The home hero's search field. Opens {@link NavPalette}, which `Layout.tsx`
 * mounts above every page.
 *
 * A BUTTON dressed as an input, not an input: a text field that swallows the
 * first keystroke to hand it to a dialog is a worse version of the same
 * interaction, and this way the whole control is one tab stop with one obvious
 * job.
 */
export const NavPaletteField = (props: NavPaletteFieldProps) => {
  const [, setOpen] = useStore(navPaletteAtom);
  const modifier = useShortcutModifier();

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        "border-input bg-background text-muted-foreground hover:border-ring/60 hover:text-foreground focus-visible:ring-ring/50 flex h-11 w-full items-center gap-2.5 rounded-lg border px-3.5 text-sm transition-colors focus-visible:ring-[3px] focus-visible:outline-none",
        props.className,
      )}
    >
      <SearchIcon className="size-4 shrink-0 opacity-70" />
      <span className="flex-1 text-left">Search blocks and pages</span>
      {/* A keycap on a phone advertises a key the reader does not have. */}
      <KbdGroup className="hidden sm:inline-flex">
        <Kbd>{modifier}</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    </button>
  );
};
