import type { MantineThemeOverride } from "@mantine/core";

export type AlephaTheme = MantineThemeOverride & {
  name: string;
  description: string;
  defaultColorScheme?: "light" | "dark"; // or "system"
};
