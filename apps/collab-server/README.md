# @tlwb/collab-server

The collaboration server: hosted boards, share keys, real-time relay of
Yjs updates and awareness, read-only enforcement, element validation,
Postgres persistence, and image assets.

## Running

```bash
docker compose up -d postgres
DATABASE_URL=postgres://tlwb:tlwb@localhost:5432/tlwb \
  CORS_ORIGIN=http://localhost:5173 \
  pnpm --filter @tlwb/collab-server dev
```

Or the whole stack: `docker compose up`.

## Configuration

| Variable                | Default    | Meaning                                |
| ----------------------- | ---------- | -------------------------------------- |
| `DATABASE_URL`          | required   | Postgres connection string             |
| `PORT`                  | `3000`     | HTTP and WebSocket port                |
| `CORS_ORIGIN`           | required   | Allowed origin for the HTTP API; `*` opens it to every origin |
| `MAX_MESSAGE_BYTES`     | `1048576`  | WebSocket message limit                |
| `MAX_DOC_BYTES`         | `5242880`  | Encoded document state limit           |
| `MAX_ASSET_BYTES`       | `10485760` | Asset upload limit                     |
| `MAX_AWARENESS_BYTES`   | `16384`    | One awareness message limit            |
| `ROOM_IDLE_MS`          | `60000`    | Idle time before a room leaves memory  |
| `COMPACT_AFTER_UPDATES` | `500`      | Residual updates before compaction     |
| `RATE_LIMIT_PER_10S`    | `200`      | Messages per connection per 10 seconds |
| `CREATE_LIMIT_PER_MIN`  | `10`       | Board creations per IP per minute      |
| `TRUST_PROXY`           | `false`    | Read the client address from `X-Forwarded-For` |
| `PUBLIC_URL`            | `CORS_ORIGIN` | Origin the MCP `create_board` share URLs are built on |
| `MCP_LIMIT_PER_MIN`     | `120`      | MCP requests per IP per minute         |
| `MCP_RENDER_LIMIT_PER_MIN` | `20`    | Renders per IP per minute              |
| `MCP_PRESENCE_MS`       | `5000`     | How long an agent stays visible after an edit |
| `MCP_MAX_BATCH`         | `200`      | Elements or ids per MCP call           |
| `MCP_MAX_IMAGE_PIXELS`  | `4000000`  | Largest PNG an MCP render produces     |

Rendering a board to PNG is synchronous native work: nothing else on
the event loop runs while it lasts, so a render stalls every live
WebSocket session for its duration. Measured on the shipped image, a
board at 4 million pixels takes roughly 75 milliseconds and one at 16
million takes 283. Two settings bound that stall: `MCP_MAX_IMAGE_PIXELS`
caps how long a single render can last, and `MCP_RENDER_LIMIT_PER_MIN`
caps how often one address can trigger one. Raise them together only
where the server is not also carrying latency-sensitive collaboration
traffic, and note that `read_board` spends the render budget only when
it is asked for an image.

Turn `TRUST_PROXY` on only when a reverse proxy you control sets
`X-Forwarded-For`: the creation limit then keys on its last entry, the
one the proxy wrote. With it off, the header is ignored entirely and
the limit keys on the socket address, because a client reaching the
port directly writes that header itself.

## API

- `POST /boards`, no body: `201 { boardId, editKey, viewKey }`. The
  server issues the id (22 characters of `[A-Za-z0-9_-]`). Keys are
  shown once and stored hashed.
- `PUT /boards/:boardId/assets/:sha256` with the image bytes as the body
  and `Authorization: Bearer <editKey>`: `201` or `200` if present. The
  content type must be `image/png`, `image/jpeg`, `image/gif`,
  `image/webp`, or `image/avif`; anything else, `image/svg+xml`
  included, is `415`.
- `GET /boards/:boardId/assets/:sha256` with either key.
- `GET /health`.
- WebSocket `/ws/:boardId?token=<key>`: the y-websocket wire format, as
  `connectBoard` from `@tlwb/store-yjs` speaks it.

WebSocket close codes: `4401` bad token, `4403` write on a view link,
`4404` unknown board, `4409` document or awareness state over its size
limit, `4422` malformed element, `4429` rate limit, `1009` message over
`MAX_MESSAGE_BYTES`, closed by the transport before the application sees
it, `1011` storage failure, `1001` shutdown.

## MCP

`POST /mcp` is a stateless Model Context Protocol endpoint (streamable
HTTP). Paste into any MCP client:

```json
{ "mcpServers": { "tlwb": { "url": "http://localhost:8080/mcp" } } }
```

The credential is the board's share link, passed as `board` to every
tool: an edit link allows mutations, a view link allows reading only.

- `create_board({ name? })`: `{ boardId, editUrl, viewUrl }`.
- `read_board({ board, image? })`: `{ meta, elements }`, plus a PNG when
  `image` is true.
- `add_elements({ board, elements, agentName? })`: `{ ids }`.
- `update_elements({ board, updates, agentName? })`: `{ updated }`.
- `delete_elements({ board, ids, agentName? })`: `{ deleted }`.
- `get_board_screenshot({ board, scale? })`: a PNG.

After a mutation the agent appears in the board's avatar stack, badged,
for `MCP_PRESENCE_MS`. Mutations go through the same validation and
persistence as a browser's; an invalid batch is refused whole.

## Deployment

Stop the old container before starting the new one, never both at once.
One process owns a board's document while it is in memory, and each
compacts from what it holds: two containers serving the same board
would write snapshots from two divergent documents and clobber each
other's. Compose makes the overlap easy to reach by accident, so
`docker compose up -d --no-deps collab-server` after a `stop`, not a
rolling replacement.

Asset storage is unbounded on purpose for now: there is no per-board
quota, no rate limit on `PUT`, and no garbage collection of blobs no
element references any more. The product ceiling is images of a few
megabytes each and a few hundred per board, and nothing enforces it, so
the deployment is expected to sit behind a rate-limiting proxy.

## Tests

```bash
docker compose up -d postgres
pnpm --filter @tlwb/collab-server test
```
