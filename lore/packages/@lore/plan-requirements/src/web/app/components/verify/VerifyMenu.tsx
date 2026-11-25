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
  /**
   * `icon` (the default) is the robot glyph of a detail page's actions;
   * `button` an outlined button reading "Verify", for a card's footer.
   */
  variant?: "icon" | "button";
  className?: string;
}

/**
 * Verify, on a detail page (#E153): the robot glyph, opening the missions
 * this subject offers. Picking one opens the Verify dialog on it, where the
 * app copy and the persona played are chosen before the prompt is copied.
 * Shown whenever `requirements` is on (decision 29). Its prompts are
 * Requirements' own, rendered on the server, not project prompts (#Q4281).
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
            props.variant === "button" ? (
              <Button
                variant="outlined"
                className={props.className}
                data-testid="verify-menu"
              />
            ) : (
              <Button
                variant="minimal"
                size="icon-lg"
                aria-label={tr("requirements.verify")}
                title={tr("requirements.verify")}
                data-testid="verify-menu"
                className={props.className}
              />
            )
          }
        >
          <Bot className="size-4" />
          {props.variant === "button" ? tr("requirements.verify") : null}
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
