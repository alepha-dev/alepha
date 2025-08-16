import { NestedView, useAlepha } from "@alepha/react";
import { Flex } from "@alepha/react-flex";
import { BlueprintProvider } from "@blueprintjs/core";
import { Analytics } from "@vercel/analytics/react";
import type { Character, Project, Task } from "../api/providers/Db.ts";
import Header from "./shared/Header.tsx";

declare module "@alepha/core" {
	interface State {
		tasks?: Task[];
		project?: Project | null;
		character?: Character | null;
		"user.projects"?: Project[];
	}
}

const Layout = () => {
	const alepha = useAlepha();
	return (
		<BlueprintProvider>
			{alepha.isProduction() ? <Analytics /> : undefined}
			<Flex col layout>
				<Header />
				<NestedView />
			</Flex>
		</BlueprintProvider>
	);
};

export default Layout;
