import { Flex, Section, SectionHeader } from "@alepha/ui";
import { IconUser } from "@tabler/icons-react";
import { t } from "alepha";
import Showcase from "../shared/Showcase.tsx";

const DemoHeading = () => {
  return (
    <Showcase
      title="SectionHeader & Section"
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

          <Section title="Basic Section">
            Section body content goes here.
          </Section>

          <Section
            title="With Icon & Actions"
            icon={IconUser}
            subtitle="A section with header features"
            actions={[{ children: "Edit", onClick: () => {} }]}
          >
            Section body with icon and actions.
          </Section>

          <Section
            title="Collapsible Section"
            collapsible
            subtitle="Click header to toggle"
          >
            This content can be collapsed.
          </Section>

          <Section title="Collapsed by Default" collapsible defaultCollapsed>
            This was hidden initially.
          </Section>

          <Section>
            Section without header — just a bordered surface container.
          </Section>
        </Flex>
      )}
    </Showcase>
  );
};

export default DemoHeading;
