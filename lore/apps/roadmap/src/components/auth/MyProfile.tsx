import { Flex } from "@mantine/core";
import type { User } from "../../api/providers/Db.ts";

export interface ProfileProps {
	user: User;
}

const MyProfile = (props: ProfileProps) => {
	return (
		<Flex bg={"var(--app-bg-color)"} flex={1} align="center" justify="center">
			TODO: Profile
		</Flex>
	);
};

export default MyProfile;
