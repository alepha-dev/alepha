import { JsonViewer } from "@alepha/ui";
import { t } from "alepha";
import { useI18n } from "alepha/react/i18n";
import Showcase from "../shared/Showcase.tsx";

const sampleData = {
  name: "Sample Project",
  createdAt: "2024-01-15T10:30:00.000Z",
  updatedAt: "2024-06-20T14:45:30.000Z",
  count: 42,
  price: 99.99,
  isActive: true,
  nullValue: null,
  tags: ["typescript", "react", "json"],
  nested: {
    level1: {
      level2: {
        deepValue: "Found me!",
      },
    },
  },
  users: [
    { id: 1, name: "Alice", role: "admin" },
    { id: 2, name: "Bob", role: "user" },
  ],
  emptyArray: [],
  emptyObject: {},
  longText:
    "This is a very long text that should be truncated when it exceeds the maximum string length configured in the viewer options.",
};

const $control = {
  switch: true,
  slider: true,
  segmented: true,
};

const jsonViewerSchema = t.object({
  showQuotes: t.boolean({
    title: "Show Quotes",
    default: false,
    $control: {
      switch: true,
    },
  }),
  showCopyButton: t.boolean({
    title: "Show Copy Button",
    default: true,
    $control: {
      switch: true,
    },
  }),
  useFormatValue: t.boolean({
    title: "Format Dates",
    default: true,
    $control: {
      switch: true,
    },
  }),
  defaultExpandedDepth: t.integer({
    title: "Expand Depth",
    default: 2,
    minimum: 0,
    maximum: 10,
    $control: { slider: true },
  }),
  maxDepth: t.integer({
    title: "Max Depth",
    default: 10,
    minimum: 1,
    maximum: 20,
    $control: { slider: true },
  }),
  size: t.enum(["xs", "sm", "md", "lg", "xl"], {
    title: "Size",
    default: "sm",
    $control: {
      segmented: true,
    },
  }),
});

const DemoJsonViewer = () => {
  const i18n = useI18n();
  const formatValue = (
    key: string | undefined,
    value: any,
  ): string | number | undefined => {
    if (key === "createdAt") {
      return i18n.l(value, { date: "LLL" });
    }
    if (key === "updatedAt") {
      return i18n.l(value, { date: "fromNow" });
    }
    return undefined;
  };

  return (
    <Showcase
      title="JsonViewer"
      schema={jsonViewerSchema}
      initialValues={{
        showQuotes: false,
        showCopyButton: true,
        useFormatValue: true,
        defaultExpandedDepth: 2,
        maxDepth: 10,
        size: "sm",
      }}
      columns={1}
    >
      {(props) => (
        <JsonViewer
          key={props.defaultExpandedDepth}
          data={sampleData}
          defaultExpandedDepth={props.defaultExpandedDepth}
          showQuotes={props.showQuotes}
          showCopyButton={props.showCopyButton}
          formatValue={props.useFormatValue ? formatValue : undefined}
          maxDepth={props.maxDepth}
          size={props.size}
        />
      )}
    </Showcase>
  );
};

export default DemoJsonViewer;
