import { NestedView, useAlepha, useRouterEvents } from "@alepha/react";
import { ColorSchemeScript, Flex, MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { theme } from "../constants/theme.ts";
import type { Character, Project, Task } from "../providers/Db.ts";
import Header from "./shared/Header.tsx";

declare module "@alepha/core" {
	interface State {
		current_assigned_tasks?: Task[];
		current_project?: Project | null;
		current_project_character?: Character | null;
		current_task?: Task | null;
		user_projects?: Project[];
	}
}

const Layout = () => {
	const alepha = useAlepha();

	useRouterEvents({
		onBegin: () => {
			nprogress.start();
		},
		onEnd: () => {
			nprogress.complete();
		},
	});

	return (
		<>
			{alepha.isProduction() ? <Analytics /> : undefined}
			{alepha.isProduction() ? <SpeedInsights /> : undefined}
			<ColorSchemeScript defaultColorScheme={theme.defaultColorScheme} />
			<MantineProvider
				defaultColorScheme={theme.defaultColorScheme}
				theme={theme.mantine}
			>
				<Notifications />
				<NavigationProgress />
				<ModalsProvider>
					<Flex className={"root"}>
						<Header />
						<NestedView />
					</Flex>
				</ModalsProvider>
			</MantineProvider>
		</>
	);
};

export default Layout;
