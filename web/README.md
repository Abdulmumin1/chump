# chump web

Browser client for Chump sessions.

It connects to an existing Chump server, streams agent events over SSE, and lets
multiple tabs or devices watch and steer the same session in realtime.

## Features

- Connect to a local or shared Chump server
- Resume a specific session with `server` and `session` query params
- Live transcript updates while the agent is working
- Shared session state across multiple browser clients
- Session sidebar for browsing and reopening sessions
- Composer support for slash commands, steering, and image attachments
- QR-based connect flow for shared links

## Connect flow

Start a Chump session in the CLI, then share it:

```bash
chump
chump share
```

Open the generated web URL, or visit the app with query params:

```text
/?server=http://127.0.0.1:8000&session=<session-id>
```

## Development

From `web/`:

```bash
pnpm dev
```

Or from the repo root:

```bash
pnpm --filter web dev
```

## Checks

```bash
pnpm check
pnpm build
```

## Demo

https://mac-file.yaqeen.me/393FBDFC-chump-lil-demo.mp4
