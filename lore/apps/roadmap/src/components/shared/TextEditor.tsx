import { RichTextEditor } from "@mantine/tiptap";
import { useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import type React from "react";

export interface TextEditorProps {
	defaultValue?: string;
	onChange?: (value: string) => void;
}

const TextEditor: React.FC<TextEditorProps> = (props) => {
	const { defaultValue = "", onChange } = props;

	const editor = useEditor({
		extensions: [StarterKit],
		content: defaultValue,
		onUpdate({ editor }) {
			onChange?.(editor.getHTML().trim());
		},
	});

	return (
		<RichTextEditor editor={editor} w={"100%"}>
			<RichTextEditor.Toolbar sticky stickyOffset="var(--docs-header-height)">
				<RichTextEditor.ControlsGroup>
					<RichTextEditor.Bold />
					<RichTextEditor.Italic />
					<RichTextEditor.Underline />
					<RichTextEditor.Strikethrough />
					<RichTextEditor.ClearFormatting />
					<RichTextEditor.Highlight />
					<RichTextEditor.CodeBlock />
				</RichTextEditor.ControlsGroup>

				<RichTextEditor.ControlsGroup>
					<RichTextEditor.H1 />
					<RichTextEditor.H2 />
					<RichTextEditor.H3 />
					<RichTextEditor.H4 />
				</RichTextEditor.ControlsGroup>

				<RichTextEditor.ControlsGroup>
					<RichTextEditor.Blockquote />
					<RichTextEditor.Hr />
					<RichTextEditor.BulletList />
					<RichTextEditor.OrderedList />
				</RichTextEditor.ControlsGroup>

				<RichTextEditor.ControlsGroup>
					<RichTextEditor.Undo />
					<RichTextEditor.Redo />
				</RichTextEditor.ControlsGroup>
			</RichTextEditor.Toolbar>

			<RichTextEditor.Content />
		</RichTextEditor>
	);
};

export default TextEditor;
