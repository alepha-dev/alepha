import { Badge, Card, CardContent } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { EstateInventoryStack } from "../../../../api/schemas/estateInventoryStackSchema.ts";

export interface BayStacksProps {
  stacks: EstateInventoryStack[];
}

/**
 * The stack environments this machine reports, next to its apps (#Q2696):
 * the revision each runs, whether it is stopped, and the volumes no backup
 * hook covers, by name.
 */
const BayStacks = (props: BayStacksProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <Card data-testid="bay-stacks">
      <CardContent className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{tr("bay.stacks.title")}</h3>
        {props.stacks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {tr("bay.stacks.empty")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 font-normal">
                  {tr("bay.stacks.col.stack")}
                </th>
                <th className="py-1 font-normal">
                  {tr("bay.stacks.col.revision")}
                </th>
                <th className="py-1 font-normal">
                  {tr("bay.stacks.col.notBackedUp")}
                </th>
              </tr>
            </thead>
            <tbody>
              {props.stacks.map((stack) => (
                <tr key={`${stack.stack}/${stack.env}`} className="border-t">
                  <td className="py-2">
                    {`${stack.stack}/${stack.env}`}{" "}
                    {stack.stopped ? (
                      <Badge variant="outline">
                        {tr("bay.stacks.stopped")}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="py-2">{stack.revision}</td>
                  <td className="py-2">
                    {(stack.notBackedUp ?? []).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
};

export default BayStacks;
