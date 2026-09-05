import { Button } from "@alepha/ui/components/ui/button";
import { Label } from "@alepha/ui/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui/components/ui/popover";
import { Switch } from "@alepha/ui/components/ui/switch";
import { useStore } from "alepha/react";
import { PanelsTopLeft } from "lucide-react";

import { shellPrefsAtom } from "@/web/shellPrefsAtom.ts";

const VARIANTS = [
  {
    id: "sidebar" as const,
    label: "Sidebar",
    hint: "Sidebar and page flush, side by side.",
  },
  {
    id: "floating" as const,
    label: "Floating",
    hint: "The sidebar is a rounded card on the page background.",
  },
  {
    id: "inset" as const,
    label: "Inset",
    hint: "The page is a rounded card on the sidebar background.",
  },
];

/**
 * Redraws the shell around the whole site, and remembers the choice.
 *
 * This is a specimen that happens to be a control: `AppShell`'s three variants
 * are the kind of thing a screenshot cannot settle, because the difference is
 * which surface owns the background. Letting a reader flip between them on a
 * real page answers it in a second.
 *
 * The state lives in a `persist: "localStorage"` atom, so it survives a reload
 * and a navigation without a server round-trip.
 */
export const ShellTweak = () => {
  const [prefs, setPrefs] = useStore(shellPrefsAtom);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Tweak the shell">
            <PanelsTopLeft className="size-4" />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Variant</Label>
            <div className="grid gap-1">
              {VARIANTS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setPrefs({ ...prefs, variant: v.id })}
                  className={
                    prefs.variant === v.id
                      ? "border-primary bg-accent rounded-md border px-2 py-1.5 text-left"
                      : "border-border hover:bg-muted rounded-md border px-2 py-1.5 text-left"
                  }
                >
                  <div className="text-xs font-medium">{v.label}</div>
                  <div className="text-muted-foreground text-[11px]">
                    {v.hint}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              <Label className="text-xs">Header outside</Label>
              {/*
                Stated rather than silently ignored: `AppShell` reads
                `headerOutside` only in `inset`, so offering it as a live
                switch elsewhere would be a control that does nothing.
              */}
              <p className="text-muted-foreground text-[11px]">
                {prefs.variant === "inset"
                  ? "Lifts the header onto the sidebar background."
                  : "Only applies to the inset variant."}
              </p>
            </div>
            <Switch
              checked={prefs.headerOutside}
              disabled={prefs.variant !== "inset"}
              onCheckedChange={(v: boolean) =>
                setPrefs({ ...prefs, headerOutside: v })
              }
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              <Label className="text-xs">Breadcrumbs</Label>
              <p className="text-muted-foreground text-[11px]">
                Show the trail above each page.
              </p>
            </div>
            <Switch
              checked={prefs.breadcrumbs}
              onCheckedChange={(v: boolean) =>
                setPrefs({ ...prefs, breadcrumbs: v })
              }
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
