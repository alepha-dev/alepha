# Attachments

A quest or a folio can carry files: a screenshot, a probe log, a CSV of
measurements, an HTML mockup someone will open. In the web app you drag one
onto the quest or paste it into the folio. From a terminal, and from an agent
working through MCP, the command is:

```bash
lore attachments push ./chart.png --project alepha --quest 1208
```

## The command

```bash
lore attachments push <file> --project <slug> --quest <shortId>
lore attachments push <file> --project <slug> --folio <shortId>
```

One file per invocation. A shell loop covers the rest:

```bash
for f in ./out/*.png; do
  lore attachments push "$f" --project alepha --folio 12
done
```

| Flag        | Meaning                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| `--project` | The project's slug, as it appears in Lore's URLs. Falls back to `LORE_PROJECT`. A numeric project id works too. |
| `--quest`   | The quest's **shortId** - the number in its URL and in `quest_get`, not the internal id.                        |
| `--folio`   | The folio's shortId. Exactly one of `--quest` / `--folio` is required.                                          |
| `--name`    | Store it under a different name. Defaults to the on-disk filename.                                              |
| `--type`    | Override the media type. Defaults to a guess from the extension.                                                |

The command needs a credential, the same one every `lore` command needs:
`lore login` on a machine with a browser, or `LORE_API_KEY` from the account's
API keys page, which is what CI has.

## A folio attachment has to be referenced

Uploading a file to a folio places it; it does not put it in the text. The
push prints the reference to paste into the body:

```txt
reference: assets/chart.png
```

```markdown
![Latency after the fix](assets/chart.png)
```

Use `![...]` for an image and `[...]` for anything else. A file nothing
references is a file nobody finds.

⚠️ **The name that comes back is the name that was stored, and it is not
always the one that was sent.** A folio auto-suffixes a name already taken on
it, so `chart.png` may land as `chart (1).png`. Read the reference the command
prints rather than composing one from the filename you passed.

A quest attachment needs no reference: it is listed on the quest.

⚠️ **A protected folio refuses an attachment.** Its content is encrypted in
the browser, so the server can neither hold the reference nor repoint it on a
rename. The editor hides its upload handler there for the same reason.

## Reading one back

`quest_attachment_get` over MCP returns an image inline, decodes a text-like
payload (html, plain, csv, markdown, json), and answers with a note naming the
file for anything else. `folio_attachment_list`, `folio_attachment_rename` and
`folio_attachment_delete` manage a folio's own list. All four are unchanged and
still live on MCP: bytes were the only thing that needed a different pipe.

## ⚠️ The MCP tools do not carry the file

`quest_attachment_add` and `folio_attachment_add` still exist, and they upload
nothing. Each confirms the target exists and returns the filled-in
`lore attachments push` line to run.

The reason is the transport. A file sent over MCP travels as base64 inside a
JSON-RPC frame, which is what capped every attachment at 2 MB - a number
nobody chose. The server has always been more generous: a quest's bucket
allows 10 MB and a folio's sets no limit at all. The cap was pure transport
tax, and it was paid on exactly the files a quest is worked from: a screenshot
at retina width, an HTML mockup with an inlined font, a CSV of measurements.

The CLI streams instead, at one chunk of peak memory, the same way
`lore artifacts push` ships a build. The two tools kept their names because an
agent looking for "attach a file to a quest" and finding nothing would paste
the file into a comment as text.

⚠️ **Your MCP session's credential does not reach a shell.** The tool says so
in what it returns, because a `lore` command that fails on a missing key one
step after a tool that worked reads as a broken CLI rather than as a missing
credential.
