import { Card, Switch } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { CornerDownRight } from "lucide-react";
import { type ReactNode, useState } from "react";

import type { AutomationGraphNode } from "../../../../../../api/schemas/automationGraphNodeSchema.ts";
import type { AutomationNodeOutcome } from "../../../../../../api/schemas/automationNodeOutcomeSchema.ts";
import type { AutomationOutlineBlock } from "../../../../../../api/schemas/AutomationOutline.ts";
import type { AutomationResourceSource } from "../../../../../../api/schemas/automationResourceSourceSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import { useAutomationLabels } from "../useAutomationLabels.ts";
import AutomationOutlineCondition from "./AutomationOutlineCondition.tsx";
import AutomationOutlineDetails from "./AutomationOutlineDetails.tsx";
import AutomationOutlineFolded from "./AutomationOutlineFolded.tsx";
import { AutomationOutlineIcons } from "./AutomationOutlineIcons.ts";
import AutomationOutlineOutcome from "./AutomationOutlineOutcome.tsx";
import AutomationOutlineRow from "./AutomationOutlineRow.tsx";
import AutomationOutlineSection from "./AutomationOutlineSection.tsx";
import AutomationOutlineSummary from "./AutomationOutlineSummary.tsx";
import type { AutomationOutlineTone } from "./AutomationOutlineTones.ts";
import type { AutomationOutlineNames } from "./useAutomationOutlineNames.ts";

export interface AutomationOutlineBlockViewProps {
  block: AutomationOutlineBlock;
  names?: AutomationOutlineNames;
  /**
   * The automation's sources as its resource reports them: each event's
   * switch and health.
   */
  sources?: AutomationResourceSource[];
  switches?: AutomationOutlineSwitches;
  /**
   * A run's outcomes, folded per node: the block is a run's evidence.
   */
  outcomes?: Map<
    string,
    {
      outcome: AutomationNodeOutcome["outcome"];
      ports: NonNullable<AutomationNodeOutcome["port"]>[];
    }
  >;
  /**
   * One of several blocks: it starts folded into one line.
   */
  folded?: boolean;
}

/**
 * An event's switch on the read-only outline (#Q3847): whether the viewer
 * may turn it on or off, and the call that does it at once.
 */
export interface AutomationOutlineSwitches {
  can: (enabled: boolean) => boolean;
  busy: boolean;
  set: (node: string, enabled: boolean) => void;
}

/**
 * One block of an automation, read-only or as a run's evidence (#Q3847):
 * When, Only if, Then (Do without a condition) and Otherwise. A row opens
 * in place to its whole configuration.
 */
const AutomationOutlineBlockView = (props: AutomationOutlineBlockViewProps) => {
  const { tr } = useI18n<I18n, "en">();
  const labels = useAutomationLabels();
  const [open, setOpen] = useState<string>();
  const [unfolded, setUnfolded] = useState(!props.folded);
  const block = props.block;
  const running = props.outcomes !== undefined;
  const toggle = (id: string) => () =>
    setOpen((current) => (current === id ? undefined : id));
  const source = (id: string) =>
    props.sources?.find((item) => item.node === id);
  const outcome = (node: AutomationGraphNode) => {
    const done = props.outcomes?.get(node.id);
    return done ? (
      <AutomationOutlineOutcome
        outcome={done.outcome}
        ports={done.ports}
        kind={node.kind}
        testId={`automation-outline-outcome-${node.id}`}
      />
    ) : undefined;
  };
  const eventSwitch = (node: AutomationGraphNode) => {
    const state = source(node.id);
    if (!state || !props.switches) return undefined;
    return (
      <span className="flex items-center gap-2">
        {!state.enabled ? (
          <span className="text-muted-foreground text-xs">
            {tr("automation.outline.off")}
          </span>
        ) : (
          state.health === "broken" && (
            <span className="text-danger-text text-xs" title={state.reason}>
              {tr("automation.state.broken")}
            </span>
          )
        )}
        <Switch
          size="sm"
          checked={state.enabled}
          disabled={props.switches.busy || !props.switches.can(!state.enabled)}
          aria-label={tr("automation.outline.switch", {
            args: [labels.source(node)],
          })}
          data-testid={`automation-outline-switch-${node.id}`}
          onCheckedChange={(enabled) => props.switches?.set(node.id, enabled)}
        />
      </span>
    );
  };
  const row = (
    node: AutomationGraphNode,
    tone: AutomationOutlineTone,
    title: ReactNode,
    extra: {
      lead?: ReactNode;
      depth?: number;
      trailing?: ReactNode;
      summary?: ReactNode;
    } = {},
  ) => (
    <AutomationOutlineRow
      key={node.id}
      tone={tone}
      icon={AutomationOutlineIcons.of(node)}
      lead={extra.lead}
      depth={extra.depth}
      title={title}
      summary={
        extra.summary ?? (
          <AutomationOutlineSummary node={node} names={props.names} />
        )
      }
      trailing={outcome(node) ?? extra.trailing}
      open={open === node.id}
      onToggle={toggle(node.id)}
      testId={`automation-outline-row-${node.id}`}
    >
      <AutomationOutlineDetails node={node} names={props.names} />
    </AutomationOutlineRow>
  );
  const sequences = (
    list: AutomationGraphNode[][],
    tone: AutomationOutlineTone,
  ) =>
    list.map((sequence, index) => (
      <div key={sequence[0].id} className="divide-y">
        {sequence.map((node, step) =>
          row(
            node,
            tone,
            tr(`automation.action.${node.type}`, { default: node.type }),
            {
              depth: step === 0 ? 0 : 1,
              lead:
                step === 0 ? (
                  <span className="bg-foreground text-background grid size-5 shrink-0 place-items-center rounded-full text-[0.7rem] font-bold">
                    {index + 1}
                  </span>
                ) : (
                  <CornerDownRight className="text-muted-foreground size-4 shrink-0" />
                ),
            },
          ),
        )}
      </div>
    ));

  const ports = block.condition
    ? (props.outcomes?.get(block.condition.id)?.ports ?? [])
    : [];
  const thenDim = running && !!block.condition && !ports.includes("true");
  const otherwiseDim = running && !!block.condition && !ports.includes("false");
  const events = block.events
    .map((node) => labels.source(node))
    .join(tr("automation.outline.or"));

  if (!unfolded) {
    const first = block.sequences[0]?.[0] ?? block.otherwise[0]?.[0];
    const count = block.sequences.flat().length + block.otherwise.flat().length;
    return (
      <Card
        className="ring-foreground/15 gap-0 py-0 shadow-sm"
        data-testid={`automation-outline-block-${block.key}`}
      >
        <AutomationOutlineFolded
          event={events}
          eventIcon={AutomationOutlineIcons.of(block.events[0])}
          detail={
            block.condition ? (
              <AutomationOutlineCondition node={block.condition} plain />
            ) : (
              <AutomationOutlineSummary
                node={block.events[0]}
                names={props.names}
              />
            )
          }
          action={
            first
              ? tr(`automation.action.${first.type}`, { default: first.type })
              : undefined
          }
          actionIcon={first ? AutomationOutlineIcons.of(first) : undefined}
          actionSummary={
            first && (
              <AutomationOutlineSummary node={first} names={props.names} />
            )
          }
          more={Math.max(0, count - 1)}
          trailing={
            block.events.length === 1 ? eventSwitch(block.events[0]) : undefined
          }
          onUnfold={() => setUnfolded(true)}
          testId={`automation-outline-folded-${block.key}`}
        />
      </Card>
    );
  }

  return (
    <Card
      className="ring-foreground/15 gap-0 py-0 shadow-sm"
      data-testid={`automation-outline-block-${block.key}`}
    >
      <div className="divide-y">
        <AutomationOutlineSection
          tone="when"
          label={tr("automation.outline.when")}
          hint={
            block.events.length > 1 ? tr("automation.outline.anyOf") : undefined
          }
          testId="automation-outline-when"
        >
          {block.events.map((node) =>
            row(node, "when", labels.source(node), {
              trailing: eventSwitch(node),
              summary:
                node.type === "schedule" && block.read ? (
                  <AutomationOutlineSummary
                    node={block.read}
                    names={props.names}
                  />
                ) : undefined,
            }),
          )}
        </AutomationOutlineSection>
        {block.condition && (
          <AutomationOutlineSection
            tone="if"
            label={tr("automation.outline.onlyIf")}
            testId="automation-outline-if"
          >
            {row(
              block.condition,
              "if",
              <AutomationOutlineCondition node={block.condition} />,
              { summary: null },
            )}
          </AutomationOutlineSection>
        )}
        <AutomationOutlineSection
          tone="do"
          label={
            block.condition
              ? tr("automation.outline.then")
              : tr("automation.outline.do")
          }
          dim={thenDim}
          hint={thenDim ? tr("automation.outline.notTaken") : undefined}
          testId="automation-outline-then"
        >
          {sequences(block.sequences, "do")}
        </AutomationOutlineSection>
        {block.condition && (
          <AutomationOutlineSection
            tone="else"
            label={tr("automation.outline.otherwise")}
            dim={otherwiseDim}
            hint={otherwiseDim ? tr("automation.outline.notTaken") : undefined}
            testId="automation-outline-otherwise"
          >
            {sequences(block.otherwise, "else")}
          </AutomationOutlineSection>
        )}
      </div>
    </Card>
  );
};

export default AutomationOutlineBlockView;
