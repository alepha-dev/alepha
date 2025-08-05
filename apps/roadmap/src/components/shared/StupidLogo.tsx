import { Flex } from "@alepha/react-flex";

const StupidLogo = () => {
	return (
		<Flex style={{ position: "relative" }}>
			<Flex
				gap1
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
			<Flex gap1 style={{ transform: "rotate(-16deg) scale(0.8)" }}>
				<Flex className={"rd-logo-bar"} style={{ width: "2px" }} />
				<Flex className={"rd-logo-bar"} style={{ width: "3px" }} />
				<Flex className={"rd-logo-bar"} style={{ width: "4px" }} />
				<Flex className={"rd-logo-bar"} style={{ width: "2px" }} />
			</Flex>
		</Flex>
	);
};

export default StupidLogo;
