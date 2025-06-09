import type { Static } from "@sinclair/typebox";
import type { post } from "../entities.ts";

interface Props {
	post: Static<typeof post.$schema>;
}

const ViewPost = ({ post }: Props) => {
	return (
		<div className="post">
			<h1>{post.title}</h1>
			<p>{post.content}</p>
			<p>Created at: {new Date(post.createdAt).toLocaleDateString()}</p>
		</div>
	);
};

export default ViewPost;
