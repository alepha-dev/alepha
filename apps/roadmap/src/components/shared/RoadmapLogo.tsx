import { Flex } from "@mantine/core";
import "./RoadmapLogo.css";

const RoadmapLogo = () => {
	return (
		<Flex style={{ position: "relative" }}>
			<Flex
				gap={8}
				style={{
					transform: "rotate(90deg) scale(0.8)",
					position: "absolute",
				}}
			>
				<Flex className={"rd-logo-bar"} style={{ width: "2px" }} />
				<Flex className={"rd-logo-bar"} style={{ width: "3px" }} />
				<Flex className={"rd-logo-bar"} style={{ width: "4px" }} />
				<Flex className={"rd-logo-bar"} style={{ width: "2px" }} />
			</Flex>
			<Flex gap={8} style={{ transform: "rotate(-16deg) scale(0.8)" }}>
				<Flex className={"rd-logo-bar"} style={{ width: "2px" }} />
				<Flex className={"rd-logo-bar"} style={{ width: "3px" }} />
				<Flex className={"rd-logo-bar"} style={{ width: "4px" }} />
				<Flex className={"rd-logo-bar"} style={{ width: "2px" }} />
			</Flex>
		</Flex>
	);
};

export default RoadmapLogo;
