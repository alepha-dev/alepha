import { Link, useClient } from "@alepha/react";
import { useState } from "react";
import type { FileCtrl } from "../controllers/FileController.ts";

const Upload = () => {
	const client = useClient().of<FileCtrl>();
	const [file, setFile] = useState<File | null>(null);

	return (
		<fieldset>
			<Link to={"/"}>Home</Link>
			<h1>Upload</h1>
			<form
				onSubmit={async (e) => {
					e.preventDefault();
					e.stopPropagation();

					if (!file) {
						return;
					}

					await client.push({
						body: {
							file,
							metadata: "test",
						},
					});

					setFile(null);
				}}
			>
				<input
					type="file"
					name="file"
					onChange={(e) => {
						if (!e.currentTarget.files) {
							return;
						}

						const file = e.currentTarget.files[0];
						setFile(file);
					}}
				/>
				<button type="submit">Upload</button>
			</form>
			<a href={"/api/download"} download>
				download
			</a>
			<img src={"/api/image"} width={200} />
		</fieldset>
	);
};

export default Upload;
