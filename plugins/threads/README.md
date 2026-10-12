# Threads

Threads makes one Claude Code chat the lead of a small team. Ask it to start a helper on a model ("start a Haiku helper to list my files and an Opus helper to review my README") and each helper runs as its own real Claude Code session in the background. You can watch what each one is doing, send it a message while it works, and get its final answer back in the lead chat once, as a short report.

## Before you start

- **Terminal login.** Run `claude auth login` in Terminal once. Helpers are separate CLI sessions, so they need the CLI's own login. Without it, Threads refuses and tells you how to fix it. It does not switch to an inline helper on its own. You can ask for one (`--inline`, or `backend: "inline"`), which runs as a background agent inside the lead chat.
- **tmux.** Run `brew install tmux`. Helpers run in a private tmux server (`tmux -L cc-threads`), so no windows pop up.
- **A trusted folder.** Open Claude Code once in the folder a helper will work in and accept the trust prompt. Threads never accepts it for you.
- Ask "check threads setup" (or run `/threads setup`) for a checklist with the exact fixes. The checklist also says whether the optional codex-computer-use mod (0.5.0 or newer) and its daemon are there. Threads works without it.

## Where it is installed

The mod is the `threads` plugin of the directory marketplace `two-mods`. Claude Code reads it in place from
`~/.claude/local-marketplaces/claude-mods-computer-use-threads/plugins/threads`.

To update it, `git pull` (or edit the files) in that folder, then run `claude plugin update threads@two-mods`. In the desktop app, quit with Cmd+Q and reopen it, because `/reload-plugins` keeps the cached copy. After every change, run `claude plugin validate .` and `claude plugin test .` from the plugin folder.

## How to use it

Ask in plain words, for example:

- "Start a Haiku helper to list the files here."
- "What is the scout doing?" / "Tell the reviewer to focus on the install section."
- "Wait for them to finish." / "Close the scout." (Threads asks before closing unless you clearly said to.)
- "Fork this chat into a Sonnet helper that writes the tests." / "Hand this off to a helper."
- "Run a plan: plan it on Opus, build it on Sonnet, test it on Haiku." Phases run one at a time. Each one leaves a handoff note for the next. Between phases, the plan carries on by itself, the lead reviews the work, or it waits for you.
- "Start a helper in its own worktree." It works on its own git branch in its own copy of the project.
- Rename, pin, hide (archive) or mark helpers as read.

`/threads` opens the panel. It lists each helper with a status dot, its model, its estimated cost and a "new" tag for unread reports, and every action is a button. The line above the prompt sums it up, for example "2 threads · 1 working".

## What it saves

- `~/.claude/threads/registry.json` holds the list of helpers and plans. It is versioned, and a newer format is left alone (read-only).
- `~/.claude/threads/events.jsonl` logs everything Threads did.
- `~/.claude/threads/plans/` keeps a record of every plan (`<id>.json` and `<id>.md`).
- `<your project>/handoff/` holds the notes plan phases leave for each other.

## Limits

- **The desktop sidebar** shows a helper only when Remote Control is available for your account and reports a link for that session. The create result says whether a link was seen. The Threads panel shows every helper either way.
- **Pin and hide** only change the Threads panel. They do not change the app's own sidebar.
- **Cost** is an estimate of API-equivalent spend from logged usage and a price table dated in the mod (`PRICES_AS_OF`). It is not your bill. "Cost unavailable" means there is no figure yet.
- **Stuck** is a guess: a helper that stays busy with no new transcript activity for 10 minutes. A long, quiet build looks the same.
- **Held messages.** When a helper's Claude Code holds a message from the lead for approval, you approve it, either in that helper or with the panel's Deliver held message button. A refused message is reported as not delivered. It is typed into the helper only if you ask.
- **Worktrees** keep helpers from editing the same working files at the same time. They do not prevent merge conflicts. A worktree with commits gets a merge command. Uncommitted changes are listed for you to review. Either way the copy is kept; only a clean copy with no commits is removed.
