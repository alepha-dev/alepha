import { useClient } from "@alepha/react";
import { useState } from "react";
import type { FileCtrl } from "../controllers/FileController.ts";

const Upload = () => {
	const client = useClient().of<FileCtrl>();
	const [file, setFile] = useState<File | null>(null);

	return (
		<fieldset>
			<h1>Upload</h1>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();

					if (!file) {
						return;
					}

					client.push({
						body: {
							file,
							metadata: "test",
						},
					});
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
		</fieldset>
	);
};

export default Upload;
