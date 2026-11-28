---
title: Agent job logs, five times smaller
description: Lore now stores an ended agent job's log gzipped, and Bay leaves out the second copy of every tool result Claude Code prints.
product: lore
---

When an agent job ends, Lore keeps its whole log for 30 days: it is what the
job's page reads to draw the transcript, and what **Download log** hands you.
Those logs were the fastest-growing thing Lore stores, so we measured one.

## Where the bytes were

A three-megabyte log of a typical run, after Bay had already replaced image
bodies with a short placeholder, broke down like this:

| What                                     | Size   |
| ---------------------------------------- | ------ |
| Tool results: the output the agent read  | 880 KB |
| A second, structured copy of each result | 510 KB |
| The agent's reasoning                    | 310 KB |
| Token usage on every turn                | 170 KB |

The second line is Claude Code's own: beside each tool result in the
conversation, its stream prints the same result again under
`tool_use_result`. Nothing in Lore reads it, and the transcript is drawn from
the first copy.

## Two changes

- **Bay drops the copy before it is written.** The pass that already cuts
  image bodies out of an agent's output now removes the top-level
  `tool_use_result` of each line too. It also stops counting toward the cap Bay
  puts on a job's output, so a long run keeps more of what matters.
- **Lore gzips the log it keeps.** The text compresses about four times. A log
  stored before the change is still read as it was, the size a job's page
  shows is still the size of the text, and **Download log** still saves plain
  text.

Together, a log takes about a fifth of the room it took. Logs still expire
after 30 days, so the storage they use now levels off five times lower.

## What you need to do

Nothing on Lore's side: it compresses every log from now on. On an Agent host,
the copy is dropped once its Bay is upgraded to the next release; until then,
Lore still compresses whatever the host sends.
