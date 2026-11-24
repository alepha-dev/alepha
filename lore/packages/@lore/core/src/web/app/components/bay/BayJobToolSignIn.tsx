import { useI18n } from "alepha/react/i18n";

import type { HostJobTool } from "../../../../api/schemas/hostInventoryJobsSchema.ts";
import type { I18n } from "../../services/I18n.ts";

export interface BayJobToolSignInProps {
  tool: HostJobTool;
  /** The jobs user, for the command that signs a tool in or out. */
  user: string;
}

/**
 * One tool's sign-in on the Tools section (#Q4256): signed in (with the
 * account), signed out (with the command that signs it in), or unknown when
 * the tool has no status command. `lore` reads the other way round: signed
 * in is a warning, since a CLI signed in on the jobs user reaches past a job
 * key's pins. git has no sign-in.
 */
const BayJobToolSignIn = (props: BayJobToolSignInProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { tool, user } = props;
  if (tool.name === "git") return null;
  if (tool.name === "lore") {
    return tool.signedIn ? (
      <span className="text-danger" data-testid="bay-job-tool-lore-warning">
        {tr("hosts.tools.loreSignedIn", {
          args: [`sudo -iu ${user} lore logout`],
        })}
      </span>
    ) : null;
  }
  if (tool.signedIn === true) {
    return (
      <span className="text-muted-foreground">
        {tool.account
          ? tr("hosts.tools.signedInAs", { args: [tool.account] })
          : tr("hosts.tools.signedIn")}
      </span>
    );
  }
  if (tool.signedIn === false) {
    return (
      <span className="text-danger">
        {tr("hosts.tools.signedOut", {
          args: [`sudo -iu ${user} ${tool.name} auth login`],
        })}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground">
      {tr("hosts.tools.signInUnknown")}
    </span>
  );
};

export default BayJobToolSignIn;
