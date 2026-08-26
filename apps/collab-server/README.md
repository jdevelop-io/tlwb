# @tlwb/collab-server

The collaboration server: hosted boards, share keys, real-time relay of
Yjs updates and awareness, read-only enforcement, element validation,
Postgres persistence, and image assets.

## Running

```bash
docker compose up -d postgres
DATABASE_URL=postgres://tlwb:tlwb@localhost:5432/tlwb pnpm --filter @tlwb/collab-server dev
```

Or the whole stack: `docker compose up`.

## Configuration

| Variable                | Default    | Meaning                                |
| ----------------------- | ---------- | -------------------------------------- |
| `DATABASE_URL`          | required   | Postgres connection string             |
| `PORT`                  | `3000`     | HTTP and WebSocket port                |
| `CORS_ORIGIN`           | required in production, `*` otherwise | Allowed origin |
| `MAX_MESSAGE_BYTES`     | `1048576`  | WebSocket message limit                |
| `MAX_DOC_BYTES`         | `5242880`  | Encoded document state limit           |
| `MAX_ASSET_BYTES`       | `10485760` | Asset upload limit                     |
| `MAX_AWARENESS_BYTES`   | `16384`    | One awareness message limit            |
| `ROOM_IDLE_MS`          | `60000`    | Idle time before a room leaves memory  |
| `COMPACT_AFTER_UPDATES` | `500`      | Residual updates before compaction     |
| `RATE_LIMIT_PER_10S`    | `200`      | Messages per connection per 10 seconds |
| `CREATE_LIMIT_PER_MIN`  | `10`       | Board creations per IP per minute      |

## API

- `POST /boards` with `{ "boardId": "<8 to 64 of [A-Za-z0-9_-]>" }`:
  `201 { boardId, editKey, viewKey }`, `409` if it exists. Keys are shown
  once and stored hashed.
- `PUT /boards/:boardId/assets/:sha256` with the image bytes as the body
  and `Authorization: Bearer <editKey>`: `201` or `200` if present.
- `GET /boards/:boardId/assets/:sha256` with either key.
- `GET /health`.
- WebSocket `/ws/:boardId?token=<key>`: the y-websocket wire format, as
  `connectBoard` from `@tlwb/store-yjs` speaks it.

WebSocket close codes: `4401` bad token, `4403` write on a view link,
`4404` unknown board, `4409` too large, `4422` malformed element, `4429`
rate limit, `1011` storage failure, `1001` shutdown.

## Tests

```bash
docker compose up -d postgres
pnpm --filter @tlwb/collab-server test
```
