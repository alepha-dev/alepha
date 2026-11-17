import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Bot } from "lucide-react";
import { useState } from "react";

import VerifyDialog, {
  MISSION_LABEL_KEYS,
  MISSIONS,
  type VerifyMission,
  type VerifySubject,
} from "./VerifyDialog.tsx";

export interface VerifyMenuProps {
  subject: Extract<VerifySubject, { kind: "usecase" | "persona" }>;
}

/**
 * Verify, on a detail page (#E153): the robot glyph every agent prompt in
 * Lore sits behind (`AgentPromptsMenu`), opening the missions this subject
 * offers. Picking one opens the Verify dialog on it, where the app copy and
 * the persona played are chosen before the prompt is copied.
 *
 * Not `AgentPromptsMenu` itself: that menu follows Plan's `agentPrompts`
 * option and copies on the click, while Verify is shown whenever
 * `requirements` is on (decision 29) and its prompt takes options.
 */
const VerifyMenu = (props: VerifyMenuProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [mission, setMission] = useState<VerifyMission>();
  const missions = MISSIONS[props.subject.kind];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="minimal"
              size="icon-lg"
              aria-label={tr("requirements.verify")}
              title={tr("requirements.verify")}
              data-testid="verify-menu"
            />
          }
        >
          <Bot className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {missions.map((it) => (
            <DropdownMenuItem key={it} onClick={() => setMission(it)}>
              {tr(MISSION_LABEL_KEYS[it])}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {mission ? (
        <VerifyDialog
          key={mission}
          subject={props.subject}
          mission={mission}
          open
          onOpenChange={(open) => {
            if (!open) setMission(undefined);
          }}
        />
      ) : null}
    </>
  );
};

export default VerifyMenu;
