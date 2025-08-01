import {
	BlueprintProvider,
	Button,
	Collapse,
	Divider,
	Drawer,
	FormGroup,
	Icon,
	InputGroup,
	Text,
} from "@blueprintjs/core";
import { useState } from "react";
import Flex from "./Flex.tsx";

const AddTask = () => {
	const [showDialog, setShowDialog] = useState(false);
	return (
		<Flex>
			<Button icon="add" intent="primary" onClick={() => setShowDialog(true)}>
				Create New Task
			</Button>
			<Drawer isOpen={showDialog} onClose={() => setShowDialog(false)}>
				<Flex bg col border fill>
					<Flex style={{ height: 128 }}></Flex>
					<Flex card fill col gap1 pad4>
						<form
							onSubmit={(e) => {
								console.log("Form submitted");
								// Handle form submission
								e.preventDefault();
								setShowDialog(false);
							}}
						>
							<FormGroup
								helperText="Helper text with details..."
								label="Task Name"
								labelFor="text-input1"
							>
								<InputGroup
									autoFocus
									id="text-input1"
									placeholder="Placeholder text"
								/>
							</FormGroup>
						</form>
					</Flex>
				</Flex>
			</Drawer>
		</Flex>
	);
};

const Item = () => {
	const [showDetails, setShowDetails] = useState(false);
	return (
		<Flex radius border bg col>
			<Flex pad2h pad1 gap2 fill>
				<Flex style={{ height: "100%" }} center>
					<Button icon={"play"} variant={"minimal"} />
				</Flex>
				<Flex center>
					<span>REACT HEAD</span>
				</Flex>
				<Flex center>
					<Icon icon={"header-one"} intent={"warning"} />
				</Flex>
				<Flex
					fill
					col
					centerY
					style={{
						overflow: "hidden",
					}}
				>
					<Text>Implementing React Head in Your Application</Text>
				</Flex>
				<Flex center gap1>
					<Button icon={"more"} variant={"minimal"} />
					<Button
						icon={showDetails ? "chevron-up" : "chevron-down"}
						variant={"minimal"}
						onClick={() => {
							setShowDetails(!showDetails);
						}}
					/>
				</Flex>
			</Flex>
			<Collapse isOpen={showDetails}>
				<Flex pad1 col>
					<Flex border card radius pad2 col center>
						<Text className={"bp6-text-muted"}>
							React Head is a powerful tool for managing the document head in
							React applications. It allows you to dynamically set the title,
							meta tags, and other head elements based on the current page or
							component state.
						</Text>
					</Flex>
				</Flex>
			</Collapse>
		</Flex>
	);
};

const Home = () => {
	return (
		<BlueprintProvider>
			<Flex col layout>
				<Flex
					border
					center
					style={{ height: 64, borderTop: 0, borderLeft: 0, borderRight: 0 }}
				>
					<Flex fill></Flex>
					<Flex pad2 gap2>
						<AddTask />
						<Button
							icon={"moon"}
							variant={"minimal"}
							onClick={() => {
								document.body.classList.toggle("bp6-dark");
								document.body.classList.toggle("dark");
							}}
						></Button>
					</Flex>
				</Flex>
				<Flex fill center card>
					<Flex
						bg
						fill
						border
						style={{
							width: 300,
							height: "100%",
							borderTop: 0,
							borderBottom: 0,
						}}
					>
						<Flex fill></Flex>
						<Flex pad2 col>
							<Button variant={"minimal"} icon={"export"} size={"large"} />
							<Button variant={"minimal"} icon={"input"} size={"large"} />
							<Button variant={"minimal"} icon={"menu"} size={"large"} />
						</Flex>
					</Flex>
					<Flex pad1 gap1 card col style={{ width: 1000, height: "100%" }}>
						<Item />
						<Item />
						<Item />
						<Item />
						<Item />
						<Divider />
						<Item />
						<Item />
						<Item />
						<Item />
					</Flex>
					<Flex
						fill
						style={{
							width: 300,
							height: "100%",
						}}
					></Flex>
				</Flex>
			</Flex>
		</BlueprintProvider>
	);
};

export default Home;
