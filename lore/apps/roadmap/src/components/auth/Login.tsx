import { useAuth } from "@alepha/react-auth";
import { Flex } from "@alepha/react-flex";
import { InputGroup } from "@blueprintjs/core";
import Action from "../shared/Action.tsx";

const Login = () => {
	const auth = useAuth();
	return (
		<Flex fill center layout>
			<Flex col gap1 style={{ width: "300px" }}>
				<Flex col pad2 gap2 card rounded shadow={2} bordered>
					<InputGroup leftIcon={"person"} placeholder={"Email"} />
					<InputGroup
						leftIcon={"key"}
						placeholder={"Password"}
						type={"password"}
					/>
					<Action>Sign in</Action>
					<Flex center>or</Flex>
					<Action>Sign in with GitHub</Action>
					<Action
						onClick={() => {
							auth.login("google");
						}}
					>
						Sign in with Google
					</Action>
				</Flex>
				<Action variant={"minimal"} link={{ to: "/" }}>
					Cancel
				</Action>
			</Flex>
		</Flex>
	);
};

export default Login;
