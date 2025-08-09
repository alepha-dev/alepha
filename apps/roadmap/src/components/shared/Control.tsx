import type { TypeBoxError } from "@alepha/core";
import type { InputField } from "@alepha/react-form";
import {
	FormGroup,
	type FormGroupProps,
	HTMLSelect,
	InputGroup,
	type InputGroupProps,
	NumericInput,
	Switch,
} from "@blueprintjs/core";

export interface ControlProps {
	formGroupProps?: FormGroupProps;
	inputGroupProps?: InputGroupProps;
	inputField: InputField;
	error?: TypeBoxError;
	fill?: boolean;
}

const Control = (props: ControlProps) => {
	if (!props.inputField?.props) {
		return null;
	}

	const renderInput = () => {
		if (props.inputField.schema?.enum) {
			return (
				<HTMLSelect
					fill={props.fill}
					id={props.inputField.props.id}
					placeholder={props.inputField.schema?.title}
					{...props.inputField.props}
				>
					{props.inputField.schema.enum.map((value: string) => (
						<option key={value} value={value}>
							{value}
						</option>
					))}
				</HTMLSelect>
			);
		}

		if (props.inputField.schema?.type === "boolean") {
			return (
				<Switch
					id={props.inputField.props.id}
					placeholder={props.inputField.schema?.title}
					{...props.inputField.props}
				/>
			);
		}

		if (
			props.inputField.schema?.type === "integer" ||
			props.inputField.schema?.type === "number"
		) {
			return (
				<NumericInput
					fill={props.fill}
					id={props.inputField.props.id}
					placeholder={props.inputField.schema?.title}
					{...props.inputField.props}
				/>
			);
		}

		return (
			<InputGroup
				fill={props.fill}
				{...props.inputField.props}
				{...props.inputGroupProps}
			/>
		);
	};

	return (
		<FormGroup
			fill={props.fill}
			label={
				props.inputField.schema?.title ?? prettyName(props.inputField.path)
			}
			labelFor={props.inputField.props.id}
			intent={
				props.inputField.path === props.error?.value.path ? "danger" : "none"
			}
			helperText={
				props.inputField.path === props.error?.value.path
					? props.error.value.message
					: props.inputField.schema?.description
			}
			{...props.formGroupProps}
		>
			{renderInput()}
		</FormGroup>
	);
};

export default Control;

const prettyName = (name: string) => {
	return capitalize(name.replaceAll("/", ""));
};

const capitalize = (str: string) => {
	return str.charAt(0).toUpperCase() + str.slice(1);
};
