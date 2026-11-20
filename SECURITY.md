# Security

## Reporting a vulnerability

Please report vulnerabilities privately with GitHub's **Report a vulnerability** button on this repository's **Security** tab. Do not post them in YouTube comments, public issues, pull requests or discussions, where anyone could use them before there is a fix.

Include what you found, how to reproduce it, and what an attacker could do with it. You will get an answer as soon as possible, but responses are best effort: this is a hobby-scale open-source project with no service-level commitment.

Only the `main` branch is supported. Fixes land there; there are no backported releases.

## What you are running

Every bot is an AI agent with a shell and your connected apps, running as you on your own computer. Anyone who can get text in front of a bot (an email it reads, a web page it opens, a message in a connected app) may be able to make it run commands. Treat a bot like a person with access to your computer.

## Using it safely

- **Keep it local.** The server listens on 127.0.0.1 only and rejects other Host headers and cross-site writes. Do not put it behind a public URL or tunnel; there is no sign-in.
- **Keys stay on this computer.** They are stored in the local database and in each agent's home, never in the web page, a repository or a chat with a bot.
- **Set spend limits** with every provider whose key you use, so a runaway or hijacked bot cannot run up a large bill.
- **Webhook routines** are triggered by anyone who knows the secret link. Treat the link like a password and delete the routine to revoke it.
- **Never show keys on screen or in recordings.** Rotate a key as soon as it may have leaked.
- **Connect only the apps a bot needs**, and keep approvals on for actions that send, post or delete.
