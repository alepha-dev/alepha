import { DetailAside } from "@alepha/ui/components/detail/detail-aside";
import { DetailLayout } from "@alepha/ui/components/detail/detail-layout";
import { useDetailTab } from "@alepha/ui/components/detail/use-detail-tab";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { z } from "alepha";
import { useRouter } from "alepha/react/router";
import {
  Activity,
  KeyRound,
  Monitor,
  Package,
  Pencil,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The shell every detail page shares: a fixed identity column, and a right
 * column whose toolbar carries tab selection on the left and actions on the
 * right.
 *
 * Rendered inside a bordered box that takes the whole preview pane, rather
 * than in flow. `DetailLayout` is `h-full min-h-0 overflow-hidden` and hands
 * the scroll to its tab body, which needs a parent with a definite height to
 * be bounded by; in a page that simply grows there is nothing for it to fill
 * and the tab body never becomes the scroller. `Showcase`'s `fill` is what
 * turns the pane into that definite height, and the box stands in for the
 * application shell that has already taken the viewport.
 *
 * The aside is hidden below `md`, so switching the viewport control to Mobile
 * shows the phone shape: tabs full width, and the identity facts left to the
 * tab bodies.
 */
const KNOBS = z.object({
  state: z
    .enum(["ready", "loading", "notFound"])
    .default("ready")
    .meta({ title: "State" }),
  tabs: z.enum(["3", "6"]).default("3").meta({ title: "Tabs" }),
  icons: z.boolean().default(true).meta({ title: "Tab icons" }),
  counts: z.boolean().default(true).meta({ title: "Tab counts" }),
  actions: z.boolean().default(true).meta({ title: "Actions" }),
});

/**
 * Six, so the `tabs` knob can push the strip past a phone's width. The strip
 * is the part that scrolls and the actions are the part that never does, which
 * is only visible once there are more tabs than room.
 */
const TABS = [
  {
    value: "overview",
    label: "Overview",
    icon: Package,
    count: undefined,
    body: "What the page opens on. The tab body is the caller's own component: DetailLayout owns the chrome and nothing else.",
  },
  {
    value: "activity",
    label: "Activity",
    icon: Activity,
    count: 12,
    body: "A count belongs on the tab rather than folded into its label, so Segmented can colour it from the segment's own state.",
  },
  {
    value: "members",
    label: "Members",
    icon: Users,
    count: 4,
    body: "Each body renders what it is given. Keeping them apart is what stops a detail page growing into one unreadable file.",
  },
  {
    value: "security",
    label: "Security",
    icon: ShieldCheck,
    count: undefined,
    body: "Dialogs belong beside DetailLayout, not in here: a tab switch would unmount them mid-answer.",
  },
  {
    value: "sessions",
    label: "Sessions",
    icon: Monitor,
    count: 3,
    body: "A body that wants its own scrollbar takes min-h-0 flex-1 overflow-auto, the way this one does.",
  },
  {
    value: "keys",
    label: "API keys",
    icon: KeyRound,
    count: undefined,
    body: "The sixth tab exists to overflow the strip on a narrow viewport. Try Mobile with the tabs knob on 6.",
  },
];

const Detail = () => {
  const router = useRouter();
  const [tab, setTab] = useDetailTab<string>("overview");

  return (
    <Showcase
      id="blocks/Detail"
      title="Detail"
      description="Identity column, tab toolbar, tab body."
      schema={KNOBS}
      initialValues={{
        state: "ready",
        tabs: "3",
        icons: true,
        counts: true,
        actions: true,
      }}
      fill
    >
      {(v) => {
        const tabs = TABS.slice(0, Number(v.tabs));
        // `useDetailTab` keeps the selection in `?tab=`, so lowering the tab
        // count can leave it pointing at a tab that is no longer offered. The
        // hook does not validate it - an unknown value falls through to
        // whatever the page renders - so the page is where it is resolved.
        const current = tabs.find((t) => t.value === tab) ?? tabs[0];

        return (
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
            <DetailLayout
              loading={v.state === "loading"}
              notFound={
                v.state === "notFound"
                  ? {
                      message: "That user no longer exists.",
                      backLabel: "Back to users",
                      // Points at this page. The showcase has nowhere else to
                      // send a reader, and a handler that did nothing would
                      // misrepresent a prop whose whole job is to be the way
                      // out.
                      onBack: () => router.push("/blocks/detail"),
                    }
                  : undefined
              }
              aside={
                <DetailAside
                  title="Ada Lovelace"
                  rows={[
                    { label: "Email", value: "ada@alepha.dev" },
                    {
                      label: "Roles",
                      value: <Badge variant="outline">owner</Badge>,
                    },
                    {
                      label: "Status",
                      value: (
                        <Badge variant="tint" tone="success">
                          active
                        </Badge>
                      ),
                    },
                    { label: "Joined", value: "1 January 2026" },
                    {
                      label: "Id",
                      copy: "00000000-0000-4000-8000-000000000001",
                    },
                  ]}
                />
              }
              tabs={tabs.map((entry) => ({
                value: entry.value,
                label: entry.label,
                icon: v.icons ? entry.icon : undefined,
                count: v.counts ? entry.count : undefined,
              }))}
              tab={current.value}
              onTabChange={setTab}
              actions={
                v.actions ? (
                  <>
                    {/* `sm`, which is what all three real consumers pass. The
                        tab selector beside it is `lg` on purpose: see
                        DetailLayout for why the two no longer match. */}
                    <Button variant="outline" size="sm">
                      <Pencil /> Edit
                    </Button>
                    <Button variant="destructive" size="sm">
                      <Trash2 /> Delete
                    </Button>
                  </>
                ) : undefined
              }
            >
              <div className="min-h-0 flex-1 overflow-auto p-4">
                <div className="rounded-lg border border-dashed p-6">
                  <p className="text-sm font-medium">{current.label}</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {current.body}
                  </p>
                </div>
              </div>
            </DetailLayout>
          </div>
        );
      }}
    </Showcase>
  );
};

export default Detail;
