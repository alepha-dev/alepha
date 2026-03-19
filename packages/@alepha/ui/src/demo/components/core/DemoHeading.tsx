import { Flex, Panel, SectionHeader } from "@alepha/ui";
import { IconUser } from "@tabler/icons-react";
import { t } from "alepha";
import Showcase from "../shared/Showcase.tsx";

const DemoHeading = () => {
  return (
    <Showcase
      title="SectionHeader & Panel"
      schema={t.object({})}
      initialValues={{}}
    >
      {() => (
        <Flex col gap="lg" w="100%">
          <SectionHeader title="Simple" />

          <SectionHeader
            title="With Icon & Subtitle"
            icon={IconUser}
            subtitle="This is a subtitle"
          />

          <SectionHeader
            title="With Actions"
            subtitle="Section with action buttons"
            actions={[
              { children: "Edit", onClick: () => {} },
              { children: "Delete", intent: "danger", onClick: () => {} },
            ]}
          />

          <Panel title="Basic Panel">Panel body content goes here.</Panel>

          <Panel
            title="With Icon & Actions"
            icon={IconUser}
            subtitle="A panel with header features"
            actions={[{ children: "Edit", onClick: () => {} }]}
          >
            Panel body with icon and actions.
          </Panel>

          <Panel
            title="Collapsible Panel"
            collapsible
            subtitle="Click header to toggle"
          >
            This content can be collapsed.
          </Panel>

          <Panel title="Collapsed by Default" collapsible defaultCollapsed>
            This was hidden initially.
          </Panel>

          <Panel>
            Panel without header — just a bordered surface container.
          </Panel>
        </Flex>
      )}
    </Showcase>
  );
};

export default DemoHeading;
