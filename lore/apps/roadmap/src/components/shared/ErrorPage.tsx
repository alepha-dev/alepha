import { Flex, Text } from "@alepha/react-flex";
import { ButtonGroup } from "@blueprintjs/core";
import { ArrowLeft, HeartBroken, Home, Reset } from "@blueprintjs/icons";
import Action from "./Action.tsx";

const ErrorPage = () => {
	return (
		<Flex fill center>
			<Flex col gap3 center>
				<Text muted>
					<HeartBroken size={48} />
				</Text>
				<Flex gap1 col center>
					<Text large bold>
						Oh no! Something went wrong.
					</Text>
					<Text muted small>
						We apologize for the inconvenience. Please try again later or
						contact support if the issue persists.
					</Text>
				</Flex>
				<Flex>
					<ButtonGroup>
						<Action
							icon={<ArrowLeft />}
							text={"Back"}
							onClick={() => window.history.back()}
						/>
						<Action
							icon={<Reset />}
							text={"Reload App"}
							onClick={() => window.location.reload()}
						/>
						<Action
							icon={<Home />}
							text={"Home"}
							onClick={() => {
								window.location.href = "/";
							}}
						/>
					</ButtonGroup>
				</Flex>
			</Flex>
		</Flex>
	);
};

export default ErrorPage;
