# Attachments

A quest or a folio can carry files: a screenshot, a log, a CSV of measurements,
an HTML mockup someone will open. In the browser you paste or drop the file.
From a terminal, and for an agent, one command does it:
`lore attachments push`.

## On a quest

Open the quest. Its **Attachments** section takes files three ways:

- click **Attach** and pick one or several files;
- drag files onto the section;
- paste a screenshot with `Ctrl+V` or `⌘V`, anywhere on the page.

Any type of file is accepted, up to 10 MB each. Each file shows as a chip on
the quest: click it to preview an image or a text file, or to open anything
else. There is nothing more to do: a file attached to a quest is listed on the
quest.

## On a folio

A folio's files are managed on the **Files** tab of the inspector, on the
right of the [folio workspace](/lore/docs/remember-folios). The folio has to
be saved once before it can take a file.

- **Add files** picks one or several files. Dropping files on the tab does the
  same.
- Pasting or dropping an image into the body while editing uploads it and
  inserts it where the cursor is.

An image wider than 1600 pixels is scaled down to that width before it is
sent.

**Uploading a file to a folio places it. It does not put it in the text.** A
file added from the **Files** tab has to be referenced from the body, as an
image or as a link:

```markdown
![Latency after the fix](assets/chart.png)
[The raw measurements](assets/latency.csv)
```

Use `![...]` for an image and `[...]` for anything else. **Copy markdown
reference** on a file's row puts the reference on your clipboard. A file
nothing references is a file nobody finds.

Renaming a file from the tab updates the references to it in that folio.
Deleting one does not: a reference to a deleted file stops resolving.

⚠️ **The name a file is stored under is not always the one you sent.** A folio
adds a suffix to a name already taken on it, so a second `chart.png` lands as
`chart (1).png`. Copy the reference from the tab instead of composing one from
the filename.

⚠️ **An encrypted folio refuses attachments.** Its content is encrypted in the
browser, so Lore can neither see the reference nor update it on a rename, and
a plain file must not sit beside encrypted content. The editor offers no upload
there.

## From the command line

```bash
lore attachments push <file> --project <slug> --quest <number>
lore attachments push <file> --project <slug> --folio <number>
```

```bash
lore attachments push ./chart.png --project acme --quest 1208
```

One file per call. A shell loop covers the rest:

```bash
for f in ./out/*.png; do
  lore attachments push "$f" --project acme --folio 12
done
```

| Flag        | Meaning                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| `--project` | The project's slug, as it appears in Lore's URLs. Falls back to `LORE_PROJECT`. A numeric project id works too. |
| `--quest`   | The quest's number: the one in its URL and in `#Q1208`, written bare.                                           |
| `--folio`   | The folio's number, written bare. Exactly one of `--quest` and `--folio` is required.                           |
| `--name`    | Store the file under a different name. Defaults to its name on disk.                                            |
| `--type`    | Override the media type. Defaults to a guess from the extension.                                                |

The command needs a credential, like every `lore` command: `lore login` on a
machine with a browser, or `LORE_API_KEY` in CI. See
[Connecting an agent](/lore/docs/agents-connecting).

A quest takes files up to 10 MB. A folio sets no limit of its own.

For a folio, the command prints the reference to paste into the body:

```txt
reference: assets/chart.png
```

⚠️ **Read the reference the command prints.** It carries the name the file was
stored under, which a folio may have suffixed, as above. An encrypted folio
refuses the push.

To read files back:

```bash
lore quest attachment get Q1208 --attachment <id> --out ./chart.png
lore folio attachment list F12
```

`lore quest get` lists a quest's attachments with their ids. A folio's files
are renamed and deleted with `lore folio attachment rename` and
`lore folio attachment delete`. The full list is in
[The lore CLI](/lore/docs/reference-cli).

## From an agent

⚠️ **The MCP tools do not carry the file.** `quest_attachment_add` and
`folio_attachment_add` upload nothing: each checks that the target exists and
can take a file, then returns the filled-in `lore attachments push` line for
the agent to run in a shell. MCP is a poor pipe for a file of any size, and the
command streams it.

⚠️ **The agent's MCP session does not sign the shell in.** The command needs
its own credential, `lore login` or `LORE_API_KEY`. The tool says so in what it
returns, because a command failing on a missing key one step after a tool that
worked reads as a broken CLI.

Reading is done over MCP. `quest_attachment_get` returns an image inline,
decodes a text file (HTML, plain text, CSV, Markdown, JSON), and answers with a
note naming the file for anything else. `folio_attachment_list`,
`folio_attachment_rename` and `folio_attachment_delete` manage a folio's files.
See [MCP tools](/lore/docs/reference-mcp-tools).

## Next

- [Folios](/lore/docs/remember-folios): the notes these files illustrate.
- [Quests](/lore/docs/plan-quests): where a screenshot explains the work.
- [The lore CLI](/lore/docs/reference-cli): install it and sign in.
