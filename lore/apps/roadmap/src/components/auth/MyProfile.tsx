import { Flex } from "@alepha/react-flex";
import type { User } from "../../api/providers/Db.ts";

export interface ProfileProps {
	user: User;
}

const MyProfile = (props: ProfileProps) => {
	return (
		<Flex bg fill center>
			profile
		</Flex>
	);
};

export default MyProfile;
