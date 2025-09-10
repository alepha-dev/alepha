import { TypeBoxError } from "@alepha/core";
import { type InputField, useFormState } from "@alepha/react-form";
import {
	Flex,
	Input,
	PasswordInput,
	type PasswordInputProps,
	SegmentedControl,
	type SegmentedControlProps,
	Select,
	type SelectProps,
	Switch,
	type SwitchProps,
	Textarea,
	type TextareaProps,
	TextInput,
	type TextInputProps,
} from "@mantine/core";
import type { ComponentType, ReactNode } from "react";

export interface ControlProps {
	input: InputField;

	title?: string;
	description?: string;

	icon?: ReactNode;

	text?: TextInputProps;
	area?: boolean | TextareaProps;
	select?: boolean | SelectProps;
	password?: boolean | PasswordInputProps;
	switch?: boolean | SwitchProps;
	segmented?: boolean | Partial<SegmentedControlProps>;

	custom?: ComponentType<CustomControlProps>;
}

const Control = (props: ControlProps) => {
	const form = useFormState(props.input);
	if (!props.input?.props) {
		return null;
	}

	// shared props

	const disabled = false; // form.loading;
	const id = props.input.props.id;
	const label =
		props.title ?? props.input.schema?.title ?? prettyName(props.input.path);
	const description = props.description ?? props.input.schema?.description;
	const error =
		form.error && form.error instanceof TypeBoxError
			? form.error.value.message
			: undefined;
	const icon = props.icon;
	const required = props.input.required;

	const inputProps = {
		label,
		description,
		error,
		required,
		disabled,
	};

	// -------------------------------------------------------------------------------------------------------------------

	if (props.custom) {
		const Custom = props.custom;
		return (
			<Input.Wrapper {...inputProps}>
				<Flex flex={1} mt={"calc(var(--mantine-spacing-xs) / 2)"}>
					<Custom
						defaultValue={props.input.props.defaultValue}
						onChange={(value) => {
							props.input.set(value);
						}}
					/>
				</Flex>
			</Input.Wrapper>
		);
	}

	if (props.segmented) {
		const segmentedControlProps: Partial<SegmentedControlProps> =
			typeof props.segmented === "object" ? props.segmented : {};
		const data =
			segmentedControlProps.data ??
			props.input.schema.enum?.map((value: string) => ({
				value,
				label: value,
			})) ??
			[];
		return (
			<Input.Wrapper {...inputProps}>
				<Flex mt={"calc(var(--mantine-spacing-xs) / 2)"}>
					<SegmentedControl
						disabled={disabled}
						defaultValue={String(props.input.props.defaultValue)}
						{...segmentedControlProps}
						onChange={(value) => {
							props.input.set(value);
						}}
						data={data}
					/>
				</Flex>
			</Input.Wrapper>
		);
	}

	// region <Select/>
	if (props.input.schema?.enum || props.select) {
		const data =
			props.input.schema.enum?.map((value: string) => ({
				value,
				label: value,
			})) ?? [];

		const selectProps = typeof props.select === "object" ? props.select : {};

		return (
			<Select
				{...inputProps}
				id={id}
				leftSection={icon}
				data={data}
				{...props.input.props}
				{...selectProps}
			/>
		);
	}
	// endregion

	// region <Switch/>

	if (props.input.schema?.type === "boolean" || props.switch) {
		const switchProps = typeof props.switch === "object" ? props.switch : {};

		return (
			<Switch
				{...inputProps}
				id={id}
				color={"blue"}
				defaultChecked={props.input.props.defaultValue}
				{...props.input.props}
				{...switchProps}
			/>
		);
	}
	// endregion

	// region <PasswordInput/>
	if (props.password) {
		const passwordInputProps =
			typeof props.password === "object" ? props.password : {};
		return (
			<PasswordInput
				{...inputProps}
				id={id}
				leftSection={icon}
				{...props.input.props}
				{...passwordInputProps}
			/>
		);
	}
	//endregion

	//region <Textarea/>
	if (props.area) {
		const textAreaProps = typeof props.area === "object" ? props.area : {};
		return (
			<Textarea
				{...inputProps}
				id={id}
				leftSection={icon}
				{...props.input.props}
				{...textAreaProps}
			/>
		);
	}
	//endregion

	// region <TextInput/>
	const textInputProps = typeof props.text === "object" ? props.text : {};
	return (
		<TextInput
			{...inputProps}
			id={id}
			leftSection={icon}
			{...props.input.props}
			{...textInputProps}
		/>
	);
	//endregion
};

export default Control;

const prettyName = (name: string) => {
	return capitalize(name.replaceAll("/", ""));
};

const capitalize = (str: string) => {
	return str.charAt(0).toUpperCase() + str.slice(1);
};

export type CustomControlProps = {
	defaultValue: any;
	onChange: (value: any) => void;
};
