import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { useState } from "react";

const sizes = ["xs", "sm", "md", "lg", "xl"] as const;

const viewOptions = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
  { value: "kanban", label: "Kanban" },
];

const planOptions = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly (-20%)" },
];

const themeOptions = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const Segment = () => {
  const [view, setView] = useState("grid");
  const [plan, setPlan] = useState("yearly");
  const [theme, setTheme] = useState("system");
  const [size, setSize] = useState<(typeof sizes)[number]>("md");
  const [withDividers, setWithDividers] = useState("on");

  const dividersOn = withDividers === "on";

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">Segmented</h1>
        <p className="text-muted-foreground text-sm">
          Animated radio-style segmented control. Defaults to dividers on.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
              Basic (controlled)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Segmented options={viewOptions} value={view} onChange={setView} />
            <p className="text-muted-foreground text-xs">
              value:{" "}
              <code className="bg-muted rounded px-1 py-0.5">{view}</code>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
              Full width
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Segmented
              options={planOptions}
              value={plan}
              onChange={setPlan}
              fullWidth
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
              Sizes
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Segmented
              options={sizes.map((s) => ({ value: s, label: s.toUpperCase() }))}
              value={size}
              onChange={(v) => setSize(v as (typeof sizes)[number])}
            />
            <div className="flex items-end gap-3">
              <Segmented
                size={size}
                options={themeOptions}
                value={theme}
                onChange={setTheme}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
              Dividers toggle
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Segmented
              options={[
                { value: "on", label: "Dividers on" },
                { value: "off", label: "Dividers off" },
              ]}
              value={withDividers}
              onChange={setWithDividers}
            />
            <Segmented
              options={viewOptions}
              defaultValue="grid"
              dividers={dividersOn}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
              Disabled (all)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Segmented options={viewOptions} defaultValue="list" disabled />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase tracking-wider">
              Disabled (one option)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Segmented
              options={[
                { value: "grid", label: "Grid" },
                { value: "list", label: "List" },
                { value: "kanban", label: "Kanban (pro)", disabled: true },
              ]}
              defaultValue="grid"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Segment;
