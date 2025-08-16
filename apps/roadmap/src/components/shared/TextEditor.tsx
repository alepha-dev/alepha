import { Flex } from "@alepha/react-flex";
import { Button, ButtonGroup, Classes, Divider } from "@blueprintjs/core";
import {
	Bold,
	Citation,
	Clean,
	CodeBlock,
	HeaderOne,
	HeaderThree,
	HeaderTwo,
	Italic,
	List,
	NumberedList,
	Redo,
	Strikethrough,
	Underline,
	Undo,
} from "@blueprintjs/icons";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import type React from "react";
import Action from "./Action.tsx";

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

	const btn = {
		variant: "minimal",
	} as const;

	return (
		<Flex bordered shadow col card overflow>
			<Flex
				bordered
				style={{
					borderTop: 0,
					borderLeft: 0,
					borderRight: 0,
				}}
			>
				<ButtonGroup>
					<Button
						{...btn}
						icon={<Bold />}
						onClick={() => editor.chain().focus().toggleBold().run()}
					/>
					<Button
						{...btn}
						icon={<Italic />}
						onClick={() => editor.chain().focus().toggleItalic().run()}
					/>
					<Button
						{...btn}
						icon={<Underline />}
						onClick={() => editor.chain().focus().toggleUnderline().run()}
					/>
					<Button
						{...btn}
						icon={<Strikethrough />}
						onClick={() => editor.chain().focus().toggleStrike().run()}
					/>
					<Button
						{...btn}
						icon={<HeaderOne />}
						onClick={() =>
							editor.chain().focus().toggleHeading({ level: 1 }).run()
						}
					/>
					<Button
						{...btn}
						icon={<HeaderTwo />}
						onClick={() =>
							editor.chain().focus().toggleHeading({ level: 2 }).run()
						}
					/>
					<Button
						{...btn}
						icon={<HeaderThree />}
						onClick={() =>
							editor.chain().focus().toggleHeading({ level: 3 }).run()
						}
					/>
					<Button
						{...btn}
						icon={<List />}
						onClick={() => editor.chain().focus().toggleBulletList().run()}
					/>
					<Button
						{...btn}
						icon={<NumberedList />}
						onClick={() => editor.chain().focus().toggleOrderedList().run()}
					/>
					<Button
						{...btn}
						icon={<Citation />}
						onClick={() => editor.chain().focus().toggleBlockquote().run()}
					/>
					<Button
						{...btn}
						icon={<CodeBlock />}
						onClick={() => editor.chain().focus().toggleCodeBlock().run()}
					/>
					<Divider />
					<Button
						{...btn}
						icon={<Undo />}
						onClick={() => editor.chain().focus().undo().run()}
					/>
					<Action
						{...btn}
						icon={<Redo />}
						onClick={() => editor.chain().focus().redo().run()}
					/>
					<Divider />
					<Action
						{...btn}
						icon={<Clean />}
						onClick={() =>
							editor.chain().focus().clearNodes().unsetAllMarks().run()
						}
					/>
				</ButtonGroup>
			</Flex>
			<Flex pad2 className={Classes.RUNNING_TEXT} overflow>
				<EditorContent
					spellCheck={false}
					editor={editor}
					style={{
						height: "256px",
						width: "100%",
					}}
				/>
			</Flex>
		</Flex>
	);
};

export default TextEditor;
