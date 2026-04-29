import type { AlephaIntent } from "@alepha/mantine";
import { Flex, Text } from "@alepha/mantine";
import { t } from "alepha";
import Showcase from "../shared/Showcase.tsx";

const showcaseSchema = t.object({
  bold: t.boolean({
    title: "bold",
    default: false,
    $control: { switch: true },
  }),
  italic: t.boolean({
    title: "italic",
    default: false,
    $control: { switch: true },
  }),
  light: t.boolean({
    title: "light",
    default: false,
    $control: { switch: true },
  }),
  muted: t.boolean({
    title: "muted",
    default: false,
    $control: { switch: true },
  }),
  small: t.boolean({
    title: "small",
    default: false,
    $control: { switch: true },
  }),
  monospace: t.boolean({
    title: "monospace",
    default: false,
    $control: { switch: true },
  }),
  uppercase: t.boolean({
    title: "uppercase",
    default: false,
    $control: { switch: true },
  }),
  capitalize: t.boolean({
    title: "capitalize",
    default: false,
    $control: { switch: true },
  }),
  center: t.boolean({
    title: "center",
    default: false,
    $control: { switch: true },
  }),
  intent: t.optional(
    t.enum(["primary", "info", "success", "warning", "danger"], {
      title: "intent",
    }),
  ),
});

const DemoText = () => {
  return (
    <Showcase
      title="Text"
      schema={showcaseSchema}
      initialValues={{
        bold: false,
        italic: false,
        light: false,
        muted: false,
        small: false,
        monospace: false,
        uppercase: false,
        capitalize: false,
        center: false,
        intent: undefined,
      }}
      columns={2}
    >
      {(props) => (
        <Flex col gap="lg" p="md" style={{ minWidth: 300 }}>
          <Text
            bold={props.bold}
            italic={props.italic}
            light={props.light}
            muted={props.muted}
            small={props.small}
            monospace={props.monospace}
            uppercase={props.uppercase}
            capitalize={props.capitalize}
            center={props.center}
            intent={(props.intent || undefined) as AlephaIntent | undefined}
          >
            The quick brown fox jumps over the lazy dog.
          </Text>
          <Text muted small>
            Muted small text for secondary information.
          </Text>
          <Text bold intent="danger">
            Bold danger text for errors.
          </Text>
          <Text monospace>console.log("monospace text");</Text>
          <Text bold uppercase muted>
            Section header style
          </Text>
        </Flex>
      )}
    </Showcase>
  );
};

export default DemoText;
