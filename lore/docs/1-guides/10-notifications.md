# Notifications

Lore tells you about things addressed to you in two places: an in-app inbox
behind the bell, and email. This page explains what reaches you, how to read and
clear the inbox, and which messages you can turn off.

## What reaches the inbox

| Message                     | Sent to                                                    | Inbox | Email |
| --------------------------- | ---------------------------------------------------------- | ----- | ----- |
| A mention                   | A member named with `@name` in a quest or feedback comment | Yes   | Yes   |
| A release published         | Every member of the project                                | Yes   | Yes   |
| A report accepted, rejected | The person who [filed it](/lore/docs/guides-feedback)      | Yes   | Yes   |
| A report answered           | The person who filed it                                    | Yes   | Yes   |
| An automation's message     | The rule's recipient, on the channel the rule names        | Yes   | Yes   |
| A quest reminder            | Whoever accepted the quest                                 | No    | Yes   |
| A project invitation        | The person invited                                         | No    | Yes   |
| A healthcheck alert         | The [monitor's recipients](/lore/docs/guides-healthchecks) | No    | Yes   |
| A Cloudflare token failing  | The estate's owner                                         | No    | Yes   |

Lore's own messages skip your own actions: a report you triage yourself sends you
nothing. An automation has no such rule, so it can tell you about something you
did. A comment that both answers a report and names its author sends one message.

An agent's comment is a comment too. Over MCP, `@name` reaches that member, the
owner of the API key the agent works as included, so an agent can ask you for a
decision.

## The bell

The bell in a project's header shows how many messages you have not read, across
**every** project, and opens a list of the latest ones. **See all** opens the
full list, on all projects.

The list lives at `/<project-slug>/inbox`. It belongs to no capability, so a
project with only Support on has one. It has no sidebar entry: the bell and the
command palette are the ways in.

- A message shows its title, a preview, its project and when it arrived. An
  unread one has a dot and a heavier title.
- Clicking a message marks it read and opens what it is about.
- **Mark all read** marks every message in the current scope.
- **This project** and **All projects** switch the scope. The address carries it
  as `?scope=all`.
- The search box filters what is loaded on the page, by title and preview, and
  **Load more** brings the next 25.

Messages are yours alone: nobody else can read them, and there is no permission
to grant.

## Turning messages off

**Notifications** in your account holds your preferences. They apply to you in
every project.

- **Email** turns off everything that would be mailed to you, except the security
  mail your account depends on, such as sign-in codes and password resets.
- **In-app** has no switch: the inbox is always on.
- **Kinds of message** are switches that apply to both channels at once. Sign-in
  codes and password resets are not listed, and stay on whatever you mute here.

| Kind               | What it covers                                                |
| ------------------ | ------------------------------------------------------------- |
| Automations        | Messages from project automation rules.                       |
| Deploy credentials | A deploy credential you own has stopped working.              |
| Your reports       | A project accepts, rejects or answers a report you submitted. |
| Healthchecks       | Confirmed outages and recoveries from your monitors.          |
| Mentions           | Somebody writes your name in a quest or feedback comment.     |
| Releases           | A project you belong to publishes a release.                  |
| Quest reminders    | Nudges about a quest you accepted, and project invitations.   |

Only a signed-in session can change them: an API key or a connected app cannot.

## For agents

There is no MCP tool for the inbox. An agent reaches a person through a comment
that names them: `quest_comment_add`, `feedback_comment_add`, or the `reason` of
`quest_hold`. Use it when you need that person, not to address the room.
