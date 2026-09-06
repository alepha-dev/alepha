import { settingsCardEdge } from "@alepha/ui/components/settings/settings-card-edge.ts";
import { SettingsDangerSection } from "@alepha/ui/components/settings/settings-danger-section";
import { SettingsHeading } from "@alepha/ui/components/settings/settings-heading";
import { SettingsLayout } from "@alepha/ui/components/settings/settings-layout";
import { SettingsNav } from "@alepha/ui/components/settings/settings-nav";
import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { Switch } from "@alepha/ui/components/ui/switch";
import { cn } from "@alepha/ui/lib/utils";
import { z } from "alepha";
import {
  CreditCard,
  LayoutDashboard,
  Monitor,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The whole settings family on one page: the two-column shell, the rail, the
 * heading, the card of rows, and the danger zone.
 *
 * They are one page rather than five because none of them is legible alone. A
 * `SettingsRow` out of its card has no divider to sit between and no padding
 * contract to honour; the card's `py-0` only means something with rows inside
 * it. What a reader needs to see is the rhythm the five make together, which
 * is the thing that drifts.
 *
 * The rail's entries all point at this page. `SettingsNav` takes fully
 * resolved hrefs and renders real `Link`s - it deliberately refuses to resolve
 * route patterns itself, because a parameterised subtree comes out with a
 * literal `:projectSlug` in every href - so there is no inert mode to put it
 * in. Pointing them here makes a click a no-op instead of a dead link, and the
 * `active` knob is what moves the highlight.
 */
const KNOBS = z.object({
  nav: z.boolean().default(true).meta({ title: "Rail" }),
  size: z
    .enum(["sm", "default"])
    .default("default")
    .meta({ title: "Rail size" }),
  active: z
    .enum(["overview", "profile", "security", "sessions", "members"])
    .default("profile")
    .meta({ title: "Current entry" }),
  header: z.boolean().default(true).meta({ title: "Header" }),
  danger: z.boolean().default(true).meta({ title: "Danger zone" }),
  fill: z.boolean().default(false).meta({ title: "fill" }),
});

/**
 * An ungrouped entry first, then two groups, and one entry that is visible but
 * not reachable. Grouping preserves first appearance, so the order here is the
 * order on screen.
 */
const ENTRIES = [
  { name: "overview", label: "Overview", icon: <LayoutDashboard /> },
  {
    name: "profile",
    label: "Profile",
    group: "Account",
    icon: <User />,
  },
  {
    name: "security",
    label: "Security",
    group: "Account",
    icon: <ShieldCheck />,
  },
  {
    name: "sessions",
    label: "Sessions",
    group: "Account",
    icon: <Monitor />,
  },
  {
    name: "members",
    label: "Members",
    group: "Workspace",
    icon: <Users />,
  },
  {
    name: "billing",
    label: "Billing",
    group: "Workspace",
    icon: <CreditCard />,
    disabled: true,
  },
];

const Settings = () => (
  <Showcase
    id="blocks/Settings"
    title="Settings"
    description="Sticky rail, cards of rows, and a danger zone."
    schema={KNOBS}
    initialValues={{
      nav: true,
      size: "default",
      active: "profile",
      header: true,
      danger: true,
      fill: false,
    }}
    fill
  >
    {(v) => (
      <div
        className={cn(
          "min-h-0 flex-1 rounded-lg border",
          // The box stands in for the application shell, and which of the two
          // hosts it plays depends on the knob.
          //
          // `SettingsLayout`'s own `fill` is for a host that has already taken
          // the viewport height and hidden its overflow: the shell bounds
          // itself to it and the content column becomes the scroller, so the
          // box hides its overflow and has nothing left to scroll.
          //
          // Off, the layout expects the PAGE to scroll and gives itself no
          // scroll region at all, because a nested one would strand the sticky
          // rail against the wrong root. The box scrolls in the document's
          // place.
          v.fill ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
        <SettingsLayout
          fill={v.fill}
          header={
            v.header ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h1 className="text-lg font-semibold tracking-tight">
                    Workspace settings
                  </h1>
                  <p className="text-muted-foreground text-sm">
                    Rendered inside the centred container, so it lines up with
                    the content rather than the viewport.
                  </p>
                </div>
                <Badge variant="tint" tone="info">
                  Team
                </Badge>
              </div>
            ) : undefined
          }
          nav={
            v.nav ? (
              <SettingsNav
                size={v.size}
                items={ENTRIES.map((entry) => ({
                  ...entry,
                  href: "/blocks/settings",
                  active: entry.name === v.active,
                }))}
              />
            ) : undefined
          }
        >
          <SettingsSection
            title="Profile"
            description="How you appear to everyone else in this workspace."
          >
            <SettingsRow
              label="Display name"
              description="Shown on everything you create."
              htmlFor="showcase-settings-name"
            >
              <Input
                id="showcase-settings-name"
                defaultValue="Ada Lovelace"
                className="w-56"
              />
            </SettingsRow>
            <SettingsRow
              label="Email"
              description="Used for sign-in and for every notification."
            >
              <span className="text-muted-foreground text-sm">
                ada@alepha.dev
              </span>
            </SettingsRow>
            <SettingsRow
              label="Weekly digest"
              description="One summary on Monday morning, instead of a mail per event."
              htmlFor="showcase-settings-digest"
            >
              <Switch id="showcase-settings-digest" defaultChecked />
            </SettingsRow>
            <SettingsRow label="Plan">
              <Button variant="outline" size="sm">
                Change plan
              </Button>
            </SettingsRow>
          </SettingsSection>

          <div className="flex flex-col gap-2">
            <SettingsHeading
              title="Active sessions"
              description="A page whose content is not a card of rows uses the heading directly, so every settings screen shares one type scale."
            />
            <div className={cn(settingsCardEdge, "p-4")}>
              <p className="text-sm">
                Anything can go in the card. Only the edge has to agree, which
                is why{" "}
                <code className="bg-muted rounded px-1">settingsCardEdge</code>{" "}
                carries the border, the radius and the shadow, and no padding.
              </p>
            </div>
          </div>

          {v.danger ? (
            <SettingsDangerSection description="These cannot be undone.">
              <SettingsRow
                label="Transfer ownership"
                description="Hand this workspace to another member."
              >
                <Button variant="destructive" size="sm">
                  Transfer
                </Button>
              </SettingsRow>
              <SettingsRow
                label="Delete this workspace"
                description="Every project, folio and quest goes with it."
              >
                <Button variant="destructive" size="sm">
                  Delete
                </Button>
              </SettingsRow>
            </SettingsDangerSection>
          ) : null}
        </SettingsLayout>
      </div>
    )}
  </Showcase>
);

export default Settings;
