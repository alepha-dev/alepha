import { Flex } from "@alepha/react-flex";
import type { User } from "../../providers/Db.ts";

export interface ProfileProps {
	user: User;
}

const Profile = (props: ProfileProps) => {
	return (
		<Flex fill center>
			<Flex pad2 center>
				🚧
			</Flex>
		</Flex>
	);
};

export default Profile;
