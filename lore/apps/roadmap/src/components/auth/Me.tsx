import { NestedView, useRouter } from "@alepha/react";
import { Flex, Text } from "@alepha/react-flex";
import { Antenna, People, User as UserIcon } from "@blueprintjs/icons";
import Action, { type ActionProps } from "../shared/Action.tsx";
import type { MeRouter } from "./MeRouter.ts";

const Me = () => {
	return (
		<Flex center>
			<Flex className={"container"} col pad2h gap3>
				<Flex>
					<Flex bordered rounded fill pad4 card bg></Flex>
				</Flex>
				<Flex hide={"md"}>
					<MeMenu mobile={true} />
				</Flex>
				<Flex gap3>
					<Flex visible={"md"}>
						<Flex col>
							<MeMenu />
						</Flex>
					</Flex>
					<Flex wFill>
						<NestedView />
					</Flex>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default Me;

const MeMenu = (props: { mobile?: boolean }) => {
	const meRouter = useRouter<MeRouter>();

	return (
		<Flex
			fill={props.mobile}
			col={!props.mobile}
			gap1
			pad1
			bordered
			rounded
			shadow
			style={props.mobile ? { width: "100%" } : { width: "196px" }}
		>
			{!props.mobile && <Text small>General</Text>}
			<ActionNavLink
				fill={props.mobile}
				visibleText={"md"}
				icon={<UserIcon />}
				text={"Profile"}
				href={meRouter.path("profile")}
			/>
			<ActionNavLink
				fill={props.mobile}
				visibleText={"md"}
				icon={<People />}
				text={"Campaigns"}
				href={meRouter.path("characters")}
			/>
			{!props.mobile && <Text small>Security</Text>}
			<ActionNavLink
				fill={props.mobile}
				visibleText={"md"}
				icon={<Antenna />}
				text={"Sessions"}
				href={meRouter.path("sessions")}
			/>
		</Flex>
	);
};

const ActionNavLink = (props: ActionProps & { href: string }) => {
	return <Action variant={"minimal"} fill alignText={"left"} {...props} />;
};
