import type { MantineThemeOverride } from "@mantine/core";

export const theme = {
	mantine: {
		fontFamily:
			'"Inter", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
		primaryColor: "green",
		primaryShade: {
			light: 9,
			dark: 7,
		},
	} as MantineThemeOverride,

	sidebarWidth: 300,
	sidebarBreakpoint: "md",

	headerHeight: { base: 48, sm: 60, lg: 76 },
	footerHeight: 32,
};
