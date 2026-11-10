import { z } from "alepha";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { useVisionMode } from "alepha/react/ui";

import { Control } from "../form/Control.tsx";
import { SettingsRow } from "../settings/SettingsRow.tsx";
import { SettingsSection } from "../settings/SettingsSection.tsx";

/**
 * How the interface is drawn for this viewer: the colour-blind palette.
 *
 * It lives on the account page rather than in the account menu because it is
 * set once, not flipped from every page. The switch is `useVisionMode()`, the
 * preference `ButtonVision` toggles for a signed-out visitor: it is kept in
 * the UI cookie, on this browser, and nothing is saved on the server.
 *
 * The server and the hydration pass read `"normal"` (see `useUiState`), so
 * the form is seeded from the mode and follows it once the cookie is read.
 */
export const AccountDisplay = () => {
  const { tr } = useI18n();
  const { vision, setVision } = useVisionMode();

  const form = useForm({
    schema: z.object({ cvd: z.boolean() }),
    initialValues: { cvd: vision === "cvd" },
    // Saves on change: one switch, with nothing else to submit beside it.
    handler: () => {},
    onChange: (_key, value) => setVision(value ? "cvd" : "normal"),
  });

  const label = tr("account.display.vision", { default: "Colour-blind mode" });

  return (
    <SettingsSection
      title={tr("account.display.title", { default: "Display" })}
      description={tr("account.display.description", {
        default: "How the interface is drawn for you, on this browser.",
      })}
    >
      <SettingsRow
        label={label}
        description={tr("account.display.visionDescription", {
          default:
            "Status colours that stay apart for red-green colour blindness.",
        })}
      >
        <Control
          switch
          input={form.input.cvd}
          label=""
          inputProps={{ "aria-label": label }}
        />
      </SettingsRow>
    </SettingsSection>
  );
};
