# The Cloudflare token

A **Cloudflare estate** is a deploy destination Lore reaches over Cloudflare's
API. You mint a token in the Cloudflare dashboard, paste it into Lore with your
account id, and Lore checks it against that account before the estate exists.
If the token is missing something, the dialog says which permission and nothing
is saved. There is no half-made estate to repair afterwards: you mint a better
token and try again.

This page is the recipe. It is worth following once rather than guessing,
because the obvious template is not quite the right one.

## Which token kind

Cloudflare issues two, and Lore accepts both. It tells them apart by their
prefix and verifies each through the endpoint that matches its kind.

| Kind                    | Prefix  | When                                                                                               |
| ----------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| **User token**          | `cfut_` | A personal Cloudflare account, or an account only you administer.                                  |
| **Account-owned token** | `cfat_` | A team account. It belongs to the account rather than to you, so it survives you leaving the team. |

Older tokens are 40 characters with no prefix at all. Those still work.

For a shared account, prefer the account-owned kind. It is the answer, on
Cloudflare's side, to "the person who set this up has left".

## Minting a user token

1. Open the Cloudflare dashboard and click your **profile icon**, top right.
2. **API Tokens**.
3. **Create Token**.
4. Scroll past the templates to **Custom token** and click **Get started**.
5. Give it a name you will recognise in six months, such as `lore-deploy`.
6. Add the permissions from the table below.
7. Under **Account Resources**, choose **Include** and pick the one account this
   estate will name. Not "All accounts": a deploy token should reach the account
   it deploys to and no other.
8. **TTL** and **Client IP Address Filtering** are optional. If you set an
   expiry, Lore shows it on the estate and re-checks the token every night, so
   you find out it lapsed before a deploy does.
9. **Continue to summary**, then **Create Token**.
10. Copy the token. Cloudflare shows it once.

## Minting an account-owned token

Same permissions, a different starting point.

1. In the dashboard, select the **account**, then **Manage Account**.
2. **Account API Tokens**.
3. **Create Token**, then **Custom token**.
4. From step 5 above, identically.

Creating an account-owned token needs **Super Administrator** on that account.
If you do not have it, the button is not there, and no amount of looking will
find it: ask whoever administers the account.

## Which permissions

All six, every one of them required. Lore refuses a token that is missing any,
because the estate is either fit to deploy to or it is not, and finding out
halfway through a deploy is worse than finding out at the form.

| Permission             | Group | What it is for                                             |
| ---------------------- | ----- | ---------------------------------------------------------- |
| **Account Settings**   | Read  | Proving the token can see the account you named.           |
| **Workers Scripts**    | Edit  | Uploading the Worker, and attaching it to a custom domain. |
| **D1**                 | Edit  | The database, when the app has one.                        |
| **Workers KV Storage** | Edit  | Key-value namespaces.                                      |
| **Workers R2 Storage** | Edit  | Object storage, for uploads and artifacts.                 |
| **Queues**             | Edit  | Background jobs.                                           |

All six are **Account** permissions. There are no Zone rows to add: every app
Lore deploys uses a plain custom domain, which Cloudflare serves as an
account-level call under Workers Scripts.

⚠️ **The obvious template is not enough.** "Edit Cloudflare Workers" is the
template most people reach for, and it covers Workers Scripts, KV and R2 but
**not D1 and not Queues**. Start from it if you like, then add those two, or
build a Custom token with all six from the start.

⚠️ **Two spellings of the same thing.** Cloudflare's dashboard says **Edit**
where its API documentation says **Write**. They are the same permission. This
page uses the dashboard's wording throughout, because that is the screen you
are looking at.

Lore checks a **read** on each of these groups, which is the honest ceiling: no
token can be proven to have Edit without writing something. The check catches
the token that has no access at all, which is the mistake people actually make;
the wording asks for Edit because Edit is what a deploy needs.

## The account id

On the dashboard's account overview page, in the right-hand column, labelled
**Account ID**. It is 32 hexadecimal characters. Copy it into the estate form
beside the token.

A token that is valid but cannot see the account you named is reported as a
**wrong account**, which is deliberately not the same message as a missing
permission: the two are fixed in different places, and one of them is a
copy-paste error.

## What happens when you save

Lore makes seven requests to Cloudflare before it writes anything: one to verify
the token itself, and one per permission group. The dialog says it is checking
while they run.

- **They all pass.** The estate is created, already valid, and ready to be lent
  to a project.
- **One fails.** The message names the permission group, in Cloudflare's own
  words, beside the field it concerns. Nothing is saved.
- **Cloudflare cannot be reached.** Lore says
  `Cloudflare could not be reached, try again` and saves nothing. It does not
  record the token as invalid, because it does not know that: an outage is not
  a verdict about your token.

### Every message, and what it means

One line per check, in the words the form uses.

| What Lore says                                                                                                                                 | What happened                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Cloudflare did not accept this token                                                                                                           | The token is not one Cloudflare recognises. A truncated paste does this.  |
| This Cloudflare token has expired                                                                                                              | Its TTL has passed. Mint a new one.                                       |
| This Cloudflare token is disabled; enable it at Cloudflare or mint a new one                                                                   | It was revoked or switched off at Cloudflare.                             |
| This Cloudflare token is not valid before _date_                                                                                               | Its start date is still in the future.                                    |
| Lore could not read Cloudflare account _id_ with this token. Either the account id is wrong, or the token is missing "Account Settings: Read". | The account probe. Two readings, because they look identical on the wire. |
| This token cannot reach Workers on this account. Add "Workers Scripts: Edit" to it and try again.                                              | The Workers probe.                                                        |
| This token cannot reach D1 on this account. Add "D1: Edit" to it and try again.                                                                | The D1 probe.                                                             |
| This token cannot reach Workers KV on this account. Add "Workers KV Storage: Edit" to it and try again.                                        | The KV probe.                                                             |
| This token cannot reach Workers R2 on this account. Add "Workers R2 Storage: Edit" to it and try again.                                        | The R2 probe.                                                             |
| This token cannot reach Queues on this account. Add "Queues: Edit" to it and try again.                                                        | The Queues probe.                                                         |
| Cloudflare could not be reached, try again                                                                                                     | Lore could not ask. Nothing was recorded either way.                      |

## What Lore stores, and what it never shows

The token is **encrypted at rest**. What the interface shows is its prefix plus
eight characters (`cfut_a1B2c3D4`), or the first eight for a legacy token with
no prefix: enough to tell two tokens apart and far too few to reconstruct one.

⚠️ **Lore never shows the token back. Not even right after you save it.** This
surprises people who created a machine estate first, so it is worth naming: for
a machine, Lore _mints_ the secret, so it shows it once, in a dialog, and stores
only a hash. For Cloudflare, **you** brought the token, you already have it, and
Lore showing it back would put it in a second place on your screen for no
reason. Replacing it is the only way to a new one, and replacing is a write:
nothing is revealed afterwards either.

## The nightly check

Once a night Lore asks Cloudflare again about every Cloudflare estate. If a
token has stopped passing, the estate shows as **credential invalid** with the
reason, and its owner gets one email. So a token revoked or narrowed at
Cloudflare is reported within a day, rather than by the first deploy that fails.

The **Check again** button in the estate's drawer does the same thing on demand,
which is what you want right after widening a token at Cloudflare.

## Deleting an estate does not revoke the token

It removes Lore's copy and the projects it was lent to lose a deploy
destination. The token itself goes on existing and working, for anything else
that holds it. To revoke it, go back to where you minted it - **API Tokens** for
a user token, **Account API Tokens** for an account-owned one - and delete it
there.
