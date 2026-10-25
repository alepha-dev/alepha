import { Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { NotFound } from "alepha/react/router";
import { useState } from "react";

import StackDeploysTab from "./StackDeploysTab.tsx";
import StackRevisionsTab from "./StackRevisionsTab.tsx";
import StackRoutesTab from "./StackRoutesTab.tsx";
import StackServicesTab from "./StackServicesTab.tsx";
import StackSettingsTab from "./StackSettingsTab.tsx";
import StackVariablesTab from "./StackVariablesTab.tsx";
import StackVolumesTab from "./StackVolumesTab.tsx";
import { useProjectStacks } from "./useProjectStacks.ts";

export interface StackEnvironmentPageProps {
  stackName: string;
  envName: string;
}

/**
 * One stack environment (#Q2696): its services with their state and the
 * per-service verbs, its deploy log, its revisions with a diff and rollback,
 * its routes, variables, volumes and settings.
 */
const StackEnvironmentPage = (props: StackEnvironmentPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { project, stacks, estates, loading } = useProjectStacks();
  const [tab, setTab] = useState("services");

  const stack = stacks.find((s) => s.name === props.stackName);
  const environment = stack?.environments.find((e) => e.env === props.envName);

  if (!project || (loading && !stack)) {
    return <Spinner />;
  }
  if (!stack || !environment) {
    return <NotFound />;
  }

  const target = {
    projectId: project.id,
    stackId: stack.id,
    environmentId: environment.id,
  };
  const tabs = [
    {
      key: "services",
      label: tr("stacks.tab.services"),
      body: (
        <StackServicesTab
          target={target}
          stackName={stack.name}
          env={environment.env}
        />
      ),
    },
    {
      key: "deploys",
      label: tr("stacks.tab.deploys"),
      body: (
        <StackDeploysTab
          target={target}
          latestRevision={stack.latestRevision}
        />
      ),
    },
    {
      key: "revisions",
      label: tr("stacks.tab.revisions"),
      body: <StackRevisionsTab target={target} env={environment.env} />,
    },
    {
      key: "routes",
      label: tr("stacks.tab.routes"),
      body: <StackRoutesTab target={target} environment={environment} />,
    },
    {
      key: "variables",
      label: tr("stacks.tab.variables"),
      body: <StackVariablesTab target={target} />,
    },
    {
      key: "volumes",
      label: tr("stacks.tab.volumes"),
      body: <StackVolumesTab target={target} />,
    },
    {
      key: "settings",
      label: tr("stacks.tab.settings"),
      body: (
        <StackSettingsTab
          target={target}
          stack={stack}
          environment={environment}
          estates={estates}
          projectSlug={project.slug ?? ""}
        />
      ),
    },
  ];

  return (
    <div
      className="flex flex-col gap-4 p-4"
      data-testid="stack-environment-page"
    >
      <div>
        <h1 className="text-lg font-semibold">{`${stack.name}/${environment.env}`}</h1>
        <p className="text-muted-foreground text-sm">
          {environment.revision
            ? tr("stacks.environment.runs", {
                args: [String(environment.revision)],
              })
            : tr("stacks.revision.none")}
        </p>
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger
              key={t.key}
              value={t.key}
              data-testid={`stack-tab-${t.key}`}
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.key} value={t.key} className="pt-4">
            {t.body}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default StackEnvironmentPage;
