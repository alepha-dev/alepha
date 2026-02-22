import { Flex, Text } from "@alepha/ui";
import { t } from "alepha";
import Showcase from "../shared/Showcase.tsx";

const showcaseSchema = t.object({
  fill: t.boolean({
    title: "fill",
    default: false,
    $control: { switch: true },
  }),
  col: t.boolean({
    title: "col",
    default: false,
    $control: { switch: true },
  }),
  center: t.boolean({
    title: "center",
    default: false,
    $control: { switch: true },
  }),
  centerX: t.boolean({
    title: "centerX",
    default: false,
    $control: { switch: true },
  }),
  centerY: t.boolean({
    title: "centerY",
    default: false,
    $control: { switch: true },
  }),
  gap: t.enum(["0", "xs", "sm", "md", "lg", "xl"], {
    title: "gap",
    default: "md",
  }),
  wrap: t.enum(["nowrap", "wrap"], {
    title: "wrap",
    default: "nowrap",
  }),
});

const Item = ({ label }: { label: string }) => (
  <Flex
    center
    style={{
      background: "var(--mantine-primary-color-light)",
      border: "1px solid var(--mantine-primary-color-light-hover)",
      borderRadius: 6,
      padding: "8px 16px",
      minWidth: 60,
      minHeight: 40,
    }}
  >
    <Text size="sm" fw={500}>
      {label}
    </Text>
  </Flex>
);

const DemoFlex = () => {
  return (
    <Showcase
      title="Flex"
      schema={showcaseSchema}
      initialValues={{
        fill: false,
        col: false,
        center: false,
        centerX: false,
        centerY: false,
        gap: "md",
        wrap: "nowrap",
      }}
      columns={1}
      windowProps={{}}
    >
      {(props) => (
        <Flex
          fill={props.fill}
          col={props.col}
          center={props.center}
          centerX={props.centerX}
          centerY={props.centerY}
          gap={props.gap === "0" ? 0 : props.gap}
          wrap={props.wrap}
          style={{
            minHeight: 200,
            border: "1px dashed var(--mantine-color-default-border)",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <Item label="A" />
          <Item label="B" />
          <Item label="C" />
        </Flex>
      )}
    </Showcase>
  );
};

export default DemoFlex;
