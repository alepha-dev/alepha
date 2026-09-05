import { BrandIcon } from "@alepha/ui/components/brand-icon/brand-icon";
import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";
import { Button } from "@alepha/ui/components/ui/button";
import { z } from "alepha";
import { Download, Plus, Trash2 } from "lucide-react";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The base `Button` across its whole matrix, plus the self-contained top-bar
 * affordances built on it.
 */
const KNOBS = z.object({
  size: z
    .enum(["sm", "default", "lg", "icon"])
    .default("default")
    .meta({ title: "size" }),
  disabled: z.boolean().default(false).meta({ title: "disabled" }),
  withIcon: z.boolean().default(true).meta({ title: "Leading icon" }),
  label: z.string().default("Button").meta({ title: "Label" }),
});

const VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;

const Buttons = () => (
  <Showcase
    title="Button"
    description="Every variant, at the size you pick."
    schema={KNOBS}
    initialValues={{
      size: "default",
      disabled: false,
      withIcon: true,
      label: "Button",
    }}
  >
    {(v) => (
      <div className="space-y-8">
        <div className="flex flex-wrap items-center gap-3">
          {VARIANTS.map((variant) => (
            <Button
              key={variant}
              variant={variant}
              size={v.size}
              disabled={v.disabled}
              aria-label={v.size === "icon" ? variant : undefined}
            >
              {v.withIcon ? <Plus /> : null}
              {v.size === "icon" ? null : v.label || variant}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">Common shapes</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size={v.size} disabled={v.disabled}>
              <Download /> Export
            </Button>
            <Button variant="destructive" size={v.size} disabled={v.disabled}>
              <Trash2 /> Delete
            </Button>
            <Button variant="outline" size="icon" aria-label="Add">
              <Plus />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            Top-bar affordances: they own their state and take no props
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonDark />
            <ButtonDark withSystem />
            <ButtonDark variant="outline" />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            Brand marks. An unknown provider falls back to a globe rather than
            rendering nothing.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <BrandIcon provider="github" className="size-6" />
            <BrandIcon provider="google" className="size-6" />
            <BrandIcon provider="apple" className="size-6" />
            <BrandIcon provider="unknown" className="size-6" />
          </div>
        </div>
      </div>
    )}
  </Showcase>
);

export default Buttons;
