import { Link, useClient, useSchema } from "@alepha/react";
import { useForm } from "@alepha/react-form";
import type Api from "./Api.ts";

const Hello = () => {
	const client = useClient<Api>();
	const loginSchema = useSchema(client.login);

	const form = useForm({
		id: "hello",
		schema: loginSchema.body,
		handler: async (values, { form }) => {
			console.log("Form submitted with values:", values);
			const x = await client.login({ body: values });
			if (x.success) {
				console.log("Login successful!");
			} else {
				console.log("Login failed!");
			}
			form.reset();
		},
		onCreateField: (name) => {
			return {
				placeholder: name,
			};
		},
	});

	return (
		<fieldset>
			<legend>Hello</legend>
			<Link to={"/page2"}>Page2</Link>

			<form onSubmit={form.onSubmit}>
				<input {...form.input("username")} />
				<input {...form.input("password")} />
				<button type={"submit"}>Submit</button>
			</form>
		</fieldset>
	);
};

export default Hello;
