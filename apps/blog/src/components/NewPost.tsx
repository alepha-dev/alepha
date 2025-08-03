import { useClient, useRouter } from "@alepha/react";
import { Button, Flex, Group, Textarea, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import type { AppRouter } from "../AppRouter.ts";
import type { PostController } from "../controllers/PostController.ts";

const NewPost = () => {
	const router = useRouter();
	const client = useClient<PostController>();

	const form = useForm({
		mode: "uncontrolled",
		initialValues: {
			title: "",
			slug: "",
			content: "",
		},
		onValuesChange: (values, previous) => {
			if (values.title !== previous.title) {
				const slug = encodeURIComponent(
					values.title.toLowerCase().replace(/\s+/g, "-"),
				);
				form.setFieldValue("slug", slug);
			}
		},
	});

	return (
		<form
			onSubmit={form.onSubmit(async (values) => {
				await client.createPost({ body: values });
				router.go<AppRouter>("home");
			})}
		>
			<Flex p={"md"} flex={1} direction={"column"} gap={"md"}>
				<Flex gap={"md"}>
					<TextInput
						flex={1}
						label={"Title"}
						key={form.key("title")}
						{...form.getInputProps("title")}
					/>
					<TextInput
						flex={1}
						label={"Slug"}
						placeholder={"my-new-post"}
						key={form.key("slug")}
						{...form.getInputProps("slug")}
					/>
				</Flex>
				<Textarea
					rows={10}
					flex={1}
					label={"Content"}
					placeholder={"Write your post here..."}
					key={form.key("content")}
					{...form.getInputProps("content")}
				/>
			</Flex>
			<Group justify="flex-end" mt="md">
				<Button type="submit">Submit</Button>
			</Group>
		</form>
	);
};

export default NewPost;
