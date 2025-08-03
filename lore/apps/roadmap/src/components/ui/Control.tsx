import type { TypeBoxError } from "@alepha/core";
import type { InputField } from "@alepha/react-form";
import {
	FormGroup,
	type FormGroupProps,
	InputGroup,
	type InputGroupProps,
} from "@blueprintjs/core";

export interface ControlProps {
	formGroupProps?: FormGroupProps;
	inputGroupProps?: InputGroupProps;
	inputField: InputField;
	error?: TypeBoxError;
}

const Control = (props: ControlProps) => {
	return (
		<FormGroup
			fill
			label={props.inputField.schema.title}
			labelFor={props.inputField.props.id}
			intent={
				props.inputField.path === props.error?.value.path ? "danger" : "none"
			}
			helperText={
				props.inputField.path === props.error?.value.path
					? props.error.value.message
					: undefined
			}
			{...props.formGroupProps}
		>
			<InputGroup {...props.inputField.props} {...props.inputGroupProps} />
		</FormGroup>
	);
};

export default Control;
