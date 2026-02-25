import type { MantineThemeOverride } from "@mantine/core";
import type { SimpleHead } from "alepha/react/head";

export type AlephaTheme = MantineThemeOverride & {
  name: string;
  description: string;
  defaultColorScheme?: "light" | "dark"; // or "system"
  head?: Pick<SimpleHead, "link" | "meta" | "script">;
};
