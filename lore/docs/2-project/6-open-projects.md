# Open projects

An open project lets anyone signed in to your Lore join it, as a viewer, from
its link. It suits a project whose plan you want to share: an open source
roadmap, a public changelog with the work behind it, a project a community
follows.

A project is **invite only** until you open it, and opening it shows nothing
to people who are not signed in.

## What a viewer sees

A viewer reads the project's memory and changes nothing:

- **quests**, with their comments, objectives and tags;
- **epics** and the roadmap;
- **folios**;
- **releases** and **areas**.

Everything else stays closed: the member list and its email addresses, ranks
and settings, reports, automations, feedback, errors, apps, hosts and
deployments. Other members appear to a viewer by name and avatar only.

A viewer gets notifications like any member, for what they can read, and can
be mentioned. They cannot be assigned a quest.

## Opening a project

1. Open **Settings ▸ Members**.
2. Under **Who can join**, choose **Open: anyone signed in can join, as a
   viewer**, and confirm.
3. Copy the **Link to share** and send it where your audience is.

The choice is off when your Lore does not allow open projects, or when the
**Viewer** rank holds more than reads. In that case the section says which
permissions are in the way, with a link to the rank.

While the project is open, the **Ranks** tab locks every Viewer permission
outside the list above: you cannot give viewers more than reads by accident.
To give someone more, move them to another rank in the **Members** tab.

Choosing **Invite only** again closes the project to new joiners. People who
already joined stay members until you remove them.

## Joining

Someone who opens the link of an open project sees its name and icon, what a
viewer can read, and **Join project**. Signed out, the button asks them to sign
in or create an account first, then brings them back to the page they opened,
as a viewer.

Opening a link never makes anyone a member: they have to click **Join
project**.

The link of a project that is not open, or of one that does not exist, answers
the same "Page not found", signed in or not, so nobody learns which projects
exist.

## Removing a viewer

Remove a viewer like any member, from their menu in the **Members** tab. They
cannot join again by themselves. Invite them to let them back in.

## The CLI and MCP in an open project

A viewer can use the `lore` CLI and an agent over MCP with a personal API key,
like any member (see [Connecting an agent](/lore/docs/agents-connecting)).
Reads work as for a member: `lore quest list`, `lore folio search` and the
matching MCP tools.

A write is refused with a sentence that says the caller is read-only in this
project, and `project_context` says so up front, so an agent plans around it
rather than trying. The CLI prints `Access: read-only` in `lore project
context`.

## Next

- [Members and ranks](/lore/docs/project-members): the four ranks every
  project starts with.
- [Notifications](/lore/docs/project-notifications): what a member, viewer
  included, hears about.
