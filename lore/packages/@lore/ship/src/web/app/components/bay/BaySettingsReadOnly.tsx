import { Card, CardContent } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Eye } from "lucide-react";

export interface BaySettingsReadOnlyProps {
  projectTitle: string;
}

/**
 * What a plain Member of the home project reads on Settings (#Q3281): the
 * common case, not an edge (members look, only the owner acts). It says what
 * they can do and which permission would let them do more, instead of a page
 * of disabled buttons.
 */
const BaySettingsReadOnly = (props: BaySettingsReadOnlyProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <Card>
      <CardContent
        className="flex items-start gap-3 text-sm"
        data-testid="bay-settings-readonly"
      >
        <Eye className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <span className="flex flex-col gap-1">
          <span>{tr("bay.settings.readOnly")}</span>
          <span className="text-muted-foreground text-xs">
            {tr("bay.settings.readOnly.how", { args: [props.projectTitle] })}
          </span>
        </span>
      </CardContent>
    </Card>
  );
};

export default BaySettingsReadOnly;
