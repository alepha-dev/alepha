import { useStore } from "alepha/react";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import AppSettingsSigil from "./AppSettingsSigil.tsx";

/**
 * Everything an operator decides about one deployed copy.
 *
 * Built on the shared settings blocks rather than a column of bespoke cards,
 * which is what puts it in the same rhythm as every other settings page in the
 * app. `SettingsSection` is `py-0` and every `SettingsRow` brings its own
 * `py-3`; leaving both on stacks into a thick blank band, so do not "fix" that
 * to a numeric padding.
 *
 * **Two controls left this page rather than being ported**, back when it was a
 * sigil's page. The four `kinds` switches and the feedback-button position read
 * as the app's configuration and are not: `SIGIL_CONFIG` in the app's own
 * deploy decides what gets SENT, and `kinds` decides only what this sink
 * ACCEPTS. Two switches for one behaviour, neither aware of the other. `kinds`
 * stays enforced in `SigilIngestService.gatesFor` and is read-only on the
 * Overview, beside what the app claims to send, which is where a disagreement
 * between them becomes visible.
 *
 * ⚠️ **The name and URL rows left with Apps v3 (#1767)** and come back in
 * #1874, against the instance rather than the credential: the address lives on
 * `app_instances.url`, and the name is `"<app>/<env>"`, a server-written mirror
 * that only `AppService` writes. The estate select and the danger zone that
 * deletes the instance arrive with them.
 */
const AppSettings = () => {
  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);

  if (!project || !instance) {
    return null;
  }

  return (
    // Settings declares its own measure. `AppLayout` used to cap every tab at
    // `max-w-6xl` so this one would not read badly at full width, which also
    // denied the width to Analytics and Vitals, which want it. Each tab
    // answers for itself now: this one at `max-w-3xl`, the rest full width.
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <AppSettingsSigil />
    </div>
  );
};

export default AppSettings;
