# Security

## Reporting a problem

Report security problems privately. Use GitHub's private vulnerability reporting: on the repository page, open the **Security** tab and click **Report a vulnerability**. Do not open a public issue for a security problem.

Please include what you found, how to reproduce it, and what it affects. We will reply as soon as we can and tell you when a fix is out.

## Keys

- **Never put an API key in an issue, a pull request, a discussion or a log you share.** If you paste one by mistake, revoke it with the provider right away. Deleting the comment is not enough.
- Heartcut reads keys only from `.env` in the Heartcut folder or from your shell environment. `.env` is gitignored.
- Heartcut never saves keys in its settings, never prints them, and never sends them to the dashboard. `npm run doctor` names the keys it finds, never their values.

## Scope

Heartcut is meant to run on your own computer. The server listens on `127.0.0.1` by default and has no login. `HEARTCUT_HOST` can change that; if you set it, anyone who can reach that address can use the dashboard and spend on your keys. Do not expose it to the internet.

Reports we care about most: a key leaking into a file, a log, an API response or the dashboard; a way to read files outside the project and media folders; a way to make a paid generation without a price shown first or past the spending cap.
