import { NestedView } from "@alepha/react";
import { Flex } from "@alepha/react-flex";
import { BlueprintProvider } from "@blueprintjs/core";
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
	return (
		<BlueprintProvider>
			<Flex col layout>
				<Header />
				<NestedView />
			</Flex>
		</BlueprintProvider>
	);
};

export default Layout;
