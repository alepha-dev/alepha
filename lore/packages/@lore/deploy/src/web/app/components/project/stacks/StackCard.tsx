import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui";
import { type I18n, useRank } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";

import type { StackResource } from "../../../../../api/schemas/stackResourceSchema.ts";
import StackEnvironmentAddForm from "./StackEnvironmentAddForm.tsx";
import StackRevisionUploadForm from "./StackRevisionUploadForm.tsx";

export interface StackCardProps {
  projectId: number;
  projectSlug: string;
  stack: StackResource;
  estates: Array<{ id: string; slug: string }>;
}

/**
 * One stack on the list: its environments (each a link to its page) with the
 * estate and the revision each runs, then the two writes that belong to the
 * stack rather than to one environment.
 */
const StackCard = (props: StackCardProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const slugOf = (id: string | undefined) =>
    props.estates.find((e) => e.id === id)?.slug;
  const canWrite = can("deploy:manage");

  return (
    <Card data-testid={`stack-card-${props.stack.name}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {props.stack.name}
          {props.stack.latestRevision ? (
            <Badge variant="outline">
              {tr("stacks.revision.latest", {
                args: [String(props.stack.latestRevision)],
              })}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {tr("stacks.estate.default.line", {
            args: [slugOf(props.stack.estateId) ?? tr("stacks.estate.unset")],
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {props.stack.environments.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {tr("stacks.environment.empty")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 font-normal">
                  {tr("stacks.col.environment")}
                </th>
                <th className="py-1 font-normal">{tr("stacks.col.estate")}</th>
                <th className="py-1 font-normal">
                  {tr("stacks.col.revision")}
                </th>
                <th className="py-1 font-normal">{tr("stacks.col.members")}</th>
              </tr>
            </thead>
            <tbody>
              {props.stack.environments.map((environment) => (
                <tr key={environment.id} className="border-t">
                  <td className="py-2">
                    <Link
                      className="text-primary underline-offset-4 hover:underline"
                      href={`/${props.projectSlug}/stacks/${props.stack.name}/${environment.env}`}
                      data-testid={`stack-environment-link-${environment.env}`}
                    >
                      {environment.env}
                    </Link>
                  </td>
                  <td className="py-2">
                    {slugOf(environment.estateId) ?? (
                      <span className="text-muted-foreground">
                        {tr("stacks.estate.default")}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {environment.revision ?? (
                      <span className="text-muted-foreground">
                        {tr("stacks.revision.none")}
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    {environment.members.map((m) => m.app).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canWrite ? (
          <div className="flex flex-wrap items-end gap-6">
            <StackEnvironmentAddForm
              projectId={props.projectId}
              stackId={props.stack.id}
            />
            <StackRevisionUploadForm
              projectId={props.projectId}
              stackId={props.stack.id}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default StackCard;
