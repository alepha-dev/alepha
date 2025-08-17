import { DateTimeProvider } from "@alepha/datetime";
import { useClient, useInject } from "@alepha/react";
import { useAuth } from "@alepha/react-auth";
import { Flex, Text } from "@alepha/react-flex";
import { Circle, Desktop, MobilePhone, SymbolCircle } from "@blueprintjs/icons";
import { useState } from "react";
import type { Session } from "../../api/providers/Db.ts";
import type { SessionApi, UserSession } from "../../api/SessionApi.ts";
import Action from "../shared/Action.tsx";

export interface MySessionsProps {
	sessions: Array<UserSession>;
}

const MySessions = (props: MySessionsProps) => {
	const dt = useInject(DateTimeProvider);
	const [sessions, setSessions] = useState<Array<UserSession>>(props.sessions);
	const auth = useAuth();
	const sessionApi = useClient<SessionApi>();

	return (
		<Flex wFill col>
			<Flex wFill pad1>
				<Flex col pad1h center>
					<Text small muted>
						You can revoke any session to log out from it.
					</Text>
				</Flex>
				<Flex fill />
				<Flex center>
					<Action
						intent={"danger"}
						text={"Revoke All"}
						variant={"minimal"}
						onClick={async () => {
							await sessionApi.revokeAllSessions();
							auth.logout();
						}}
					/>
				</Flex>
			</Flex>
			<Flex wFill gap1 col bg pad1 rounded bordered overflow>
				{sessions.map((session) => (
					<Flex
						pad1
						wFill
						key={session.id}
						card
						bordered
						rounded
						shadow
						gap2
						pad2h
					>
						<Flex col centerY>
							<Flex>
								<SymbolCircle
									size={16}
									color={session.current ? "green" : "gray"}
								/>
							</Flex>
						</Flex>

						<Flex col center gap1 pad1>
							<Flex center>
								{session.userAgent?.device === "Mobile" ? (
									<MobilePhone />
								) : (
									<Desktop />
								)}
							</Flex>
						</Flex>
						<Flex>
							<Flex col centerY>
								<Text>
									{session.userAgent?.browser} ({session.userAgent?.os})
								</Text>
								<Text small muted>
									Signed in {dt.of(session.createdAt).fromNow()}
								</Text>
							</Flex>
						</Flex>
						<Flex fill />
						<Flex center>
							<Action
								variant={"minimal"}
								text={session.current ? "Sign out" : "Revoke"}
								onClick={async () => {
									if (session.current) {
										auth.logout();
									} else {
										await sessionApi.revokeSession({
											params: {
												sessionId: session.id,
											},
										});
										setSessions((prev) =>
											prev.filter((s) => s.id !== session.id),
										);
									}
								}}
							/>
						</Flex>
					</Flex>
				))}
			</Flex>
		</Flex>
	);
};

export default MySessions;

// ---------------------------------------------------------------------------------------------------------------------

// Support only Android for now

const getDeviceIconFromUserAgent = (userAgent: string) => {
	if (userAgent.includes("Android")) {
		return <MobilePhone />;
	} else {
		return <Desktop />;
	}
};

const getOsFromUserAgent = (userAgent: string) => {
	if (userAgent.includes("Android")) {
		return "Android";
	} else if (userAgent.includes("Win64")) {
		return "Windows";
	} else {
		return "Windows";
	}
};
