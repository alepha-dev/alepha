import { Button } from "@alepha/ui";
import { ButtonDark } from "@alepha/ui/shell";
import { z } from "alepha";
import { Download, Plus, Trash2 } from "lucide-react";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The base `Button` across its whole matrix: every `variant` x `intent`
 * pair, every size, every state, and the self-contained top-bar affordances
 * built on it.
 */
const KNOBS = z.object({
  size: z
    .enum(["xs", "sm", "default", "lg"])
    .default("default")
    .meta({ title: "size" }),
  disabled: z.boolean().default(false).meta({ title: "disabled" }),
  loading: z.boolean().default(false).meta({ title: "loading" }),
  withIcon: z.boolean().default(true).meta({ title: "Leading icon" }),
  label: z.string().default("").meta({ title: "Label" }),
});

const VARIANTS = ["solid", "minimal", "outlined", "link"] as const;

const INTENTS = ["none", "primary", "success", "warning", "danger"] as const;

const SIZES = ["xs", "sm", "default", "lg"] as const;

const ICON_SIZES = ["icon-xs", "icon-sm", "icon", "icon-lg"] as const;

const Buttons = () => (
  <Showcase
    id="blocks/Buttons"
    title="Button"
    description="Two axes, after Blueprint: intent is the colour, variant is the weight."
    schema={KNOBS}
    initialValues={{
      size: "default",
      disabled: false,
      loading: false,
      withIcon: true,
      label: "",
    }}
  >
    {(v) => (
      <div className="space-y-10">
        <section className="space-y-3">
          <p className="text-muted-foreground text-xs">
            variant x intent, at the size you pick
          </p>
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-x-3 border-spacing-y-2">
              <thead>
                <tr>
                  <th />
                  {INTENTS.map((intent) => (
                    <th
                      key={intent}
                      className="text-muted-foreground text-left font-mono text-xs font-normal"
                    >
                      {intent}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {VARIANTS.map((variant) => (
                  <tr key={variant}>
                    <td className="text-muted-foreground pr-2 font-mono text-xs">
                      {variant}
                    </td>
                    {INTENTS.map((intent) => (
                      <td key={intent}>
                        <Button
                          variant={variant}
                          intent={intent}
                          size={v.size}
                          disabled={v.disabled}
                          loading={v.loading}
                        >
                          {v.withIcon ? <Plus /> : null}
                          {v.label || capitalize(intent)}
                        </Button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-muted-foreground text-xs">Icon only</p>
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-x-3 border-spacing-y-2">
              <tbody>
                {VARIANTS.map((variant) => (
                  <tr key={variant}>
                    <td className="text-muted-foreground pr-2 font-mono text-xs">
                      {variant}
                    </td>
                    {INTENTS.map((intent) => (
                      <td key={intent}>
                        <Button
                          variant={variant}
                          intent={intent}
                          size="icon"
                          disabled={v.disabled}
                          loading={v.loading}
                          aria-label={`${variant} ${intent}`}
                        >
                          <Plus />
                        </Button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-muted-foreground text-xs">Every size</p>
          <div className="flex flex-wrap items-center gap-3">
            {SIZES.map((size) => (
              <Button key={size} size={size} disabled={v.disabled}>
                {v.withIcon ? <Plus /> : null}
                {size}
              </Button>
            ))}
            {ICON_SIZES.map((size) => (
              <Button
                key={size}
                size={size}
                disabled={v.disabled}
                aria-label={size}
              >
                <Plus />
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-muted-foreground text-xs">
            States: rest, disabled, loading, expanded (a menu trigger that is
            open)
          </p>
          <div className="space-y-2">
            {VARIANTS.map((variant) => (
              <div key={variant} className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground w-16 font-mono text-xs">
                  {variant}
                </span>
                <Button variant={variant} size={v.size}>
                  Rest
                </Button>
                <Button variant={variant} size={v.size} disabled>
                  Disabled
                </Button>
                <Button variant={variant} size={v.size} loading>
                  Loading
                </Button>
                <Button variant={variant} size={v.size} aria-expanded>
                  Expanded
                </Button>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-muted-foreground text-xs">
            With `href`: an app path renders a router `Link`, an absolute URL a
            plain anchor. The look is the variant's, unchanged
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button href="/blocks/shell" size={v.size}>
              Get started
            </Button>
            <Button href="/blocks/shell" variant="outlined" size={v.size}>
              Outlined link
            </Button>
            <Button href="/blocks/shell" variant="minimal" size={v.size}>
              Minimal link
            </Button>
            <Button href="/blocks/shell" variant="link" size={v.size}>
              Text link
            </Button>
            <Button
              href="https://github.com/alepha-dev/alepha"
              target="_blank"
              variant="outlined"
              size={v.size}
            >
              External, new tab
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-muted-foreground text-xs">Common shapes</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size={v.size} disabled={v.disabled}>
              <Plus /> New project
            </Button>
            <Button variant="outlined" size={v.size} disabled={v.disabled}>
              <Download /> Export
            </Button>
            <Button
              variant="minimal"
              intent="danger"
              size={v.size}
              disabled={v.disabled}
            >
              <Trash2 /> Delete
            </Button>
            <Button intent="danger" size={v.size} disabled={v.disabled}>
              <Trash2 /> Delete forever
            </Button>
            <Button intent="success" size={v.size} disabled={v.disabled}>
              Publish
            </Button>
            <Button variant="outlined" size="icon" aria-label="Add">
              <Plus />
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-muted-foreground text-xs">
            Top-bar affordances: they own their state and take no props
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonDark />
            <ButtonDark withSystem />
            <ButtonDark variant="outlined" />
          </div>
        </section>
      </div>
    )}
  </Showcase>
);

const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

export default Buttons;
