import type {
  OrganizationController,
  OrganizationSummaryResource,
} from "alepha/api/organizations";
import { useAction, useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ArrowRight, Building2, Plus } from "lucide-react";

import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "../core/Card.tsx";
import { useDialog } from "../core/useDialog.tsx";
import { useToast } from "../core/useToast.tsx";
import { SettingsHeading } from "../settings/SettingsHeading.tsx";

export interface MyOrganizationsProps {
  onOpen: (organization: OrganizationSummaryResource) => void | Promise<void>;
}

export const MyOrganizations = (props: MyOrganizationsProps) => {
  const api = useClient<OrganizationController>();
  const dialog = useDialog();
  const toaster = useToast();
  const { tr } = useI18n();
  const organizations = useQuery(
    {
      key: ["my-organizations"],
      handler: () => api.getMyOrganizations(),
    },
    [api],
  );
  const create = useAction<[], void>(
    {
      handler: async () => {
        const name = await dialog.prompt({
          title: tr("organizations.mine.createTitle", {
            default: "Create organization",
          }),
          description: tr("organizations.mine.createDescription", {
            default: "Give the new organization a name.",
          }),
          label: tr("organizations.mine.name", {
            default: "Organization name",
          }),
          confirmLabel: tr("organizations.mine.createConfirm", {
            default: "Create",
          }),
          cancelLabel: tr("organizations.mine.cancel", { default: "Cancel" }),
          validate: (value) =>
            value.trim().length > 0
              ? null
              : tr("organizations.mine.nameRequired", {
                  default: "Enter an organization name",
                }),
        });
        if (name === null) return;
        const organization = await api.createOrganization({
          body: { name: name.trim() },
        });
        await organizations.refetch();
        toaster.success(
          tr("organizations.mine.created", {
            default: "$1 created",
            args: [organization.name],
          }),
        );
        await props.onOpen({ ...organization, rank: "owner" });
      },
    },
    [api, dialog, organizations, props.onOpen, toaster, tr],
  );
  const items = organizations.data ?? [];
  const busy = organizations.loading || create.loading;

  return (
    <section className="flex w-full flex-col gap-4" aria-busy={busy}>
      <div className="flex items-start justify-between gap-4">
        <SettingsHeading
          title={tr("organizations.mine.title", {
            default: "My organizations",
          })}
          description={tr("organizations.mine.description", {
            default: "Open an organization or create a new one.",
          })}
        />
        <div className="shrink-0">
          <Button disabled={busy} onClick={() => void create.run()}>
            <Plus className="size-4" />
            {tr("organizations.mine.create", {
              default: "Create organization",
            })}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <Card className="items-center py-10 text-center">
          <Building2 className="text-muted-foreground size-6" />
          <CardContent className="text-muted-foreground">
            {tr("organizations.mine.empty", {
              default: "You do not belong to an organization yet.",
            })}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((organization) => (
            <Card key={organization.id} size="sm">
              <CardHeader>
                <CardTitle className="flex min-w-0 items-center gap-2">
                  <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
                    <Building2 className="size-4" />
                  </span>
                  <span className="truncate">{organization.name}</span>
                </CardTitle>
                <CardAction>
                  <Badge variant="secondary" className="capitalize">
                    {organization.rank.charAt(0).toUpperCase() +
                      organization.rank.slice(1)}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full justify-between"
                  variant="outlined"
                  disabled={busy}
                  aria-label={tr("organizations.mine.openLabel", {
                    default: "Open $1",
                    args: [organization.name],
                  })}
                  onClick={() => void props.onOpen(organization)}
                >
                  {tr("organizations.mine.open", { default: "Open" })}
                  <ArrowRight className="size-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
};
