import type { MantineColorScheme, MantineTheme } from "@mantine/core";

export const theme = {
	defaultColorScheme: "dark" as MantineColorScheme,
	mantine: {
		primaryColor: "gray",
		primaryShade: {
			light: 9,
			dark: 8,
		},
		cursorType: "pointer",
	} as MantineTheme,
	container: {
		base: "100%",
		md: "800px",
		lg: "800px",
		xl: "920px",
		xxl: "1200px",
	},
	colors: {
		card: "var(--card-bg-color)",
		panel: "var(--panel-bg-color)",
		app: "var(--app-bg-color)",
		gold: "var(--color-gold)",
		silver: "var(--color-silver)",
		bronze: "var(--color-bronze)",
	},
	icon: {
		size: {
			xs: 12,
			sm: 16,
			md: 20,
			lg: 24,
			xl: 32,
		},
	},
};
