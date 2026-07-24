# Bobarr v2

Bobarr is a self-hosted movie and television acquisition manager. It combines a
responsive React interface with a versioned Bun API, while keeping the services
that are particularly good at tracker access and BitTorrent transport:

- TMDB provides discovery and metadata.
- Jackett provides Torznab search and owns indexer credentials.
- FlareSolverr is used by Jackett when an indexer needs it.
- Transmission 4.1.3 downloads and seeds; Bobarr remains the normal control
  surface.

Bobarr v2 is a greenfield build. It does not migrate the legacy PostgreSQL or
Redis databases. Existing media can be adopted through the library scanner.

## Quick start

Requirements: Docker Engine with Compose v2.24 or newer, a TMDB v4 read-access
token or v3 API key, and writable host folders for configuration and media.

```sh
cp .env.example .env
mkdir -p config/jackett config/transmission media/downloads media/movies media/tv
docker compose up --build
```

Set either `TMDB_ACCESS_TOKEN` for a v4 read-access token or `TMDB_API_KEY` for a
v3 API key, and replace `TRANSMISSION_PASSWORD` in `.env` before the first start.
On Linux, also set `PUID` and `PGID` to the owner of the directories above
(`id -u` and `id -g`). Open <http://localhost:3000>, create the administrator,
then verify the services from Settings. Jackett's setup UI is published on host
port 9117 by default. Configure indexers and FlareSolverr there. Set
`JACKETT_BIND_ADDRESS=127.0.0.1` to restrict it to local access. Transmission's
authenticated Web UI is published on host port 9091. Set
`TRANSMISSION_BIND_ADDRESS=127.0.0.1` to restrict it to local access; Bobarr
remains the normal control surface. Transmission's peer port is published over
both TCP and UDP on port 51413 by default. Forward both protocols from the
internet router to the Docker host and allow them through the host firewall so
remote peers can initiate connections. The
Compose default permits its session cookie over direct HTTP access, including a
private Tailscale address. Set `BOBARR_COOKIE_SECURE=true` when serving Bobarr
over HTTPS.

All three media folders must live below the same `/media` mount if hardlink
organization is enabled. This lets Transmission continue seeding without a
second copy of each file.

## Development

Bobarr is pinned to Bun 1.3.14.

```sh
bun install --frozen-lockfile
bun run dev
```

The development server exposes the SPA and API on <http://localhost:3000>.
Useful commands:

```sh
bun run fmt
bun run lint
bun run test
bun run build
bun run test:e2e
```

The REST API is rooted at `/api/v1`, OpenAPI is published at
`/api/openapi.json`, and authenticated server events are available from
`/api/v1/events`. Liveness and readiness probes are `/health/live` and
`/health/ready`.

## Deployment

The base [Compose stack](./compose.yml) runs Bobarr, Jackett, FlareSolverr, and
Transmission on one private application network. Bobarr, Jackett, and
Transmission's authenticated diagnostic UI use configurable host bindings;
Transmission also publishes its peer port, while FlareSolverr has no host port.

To route only Transmission through a VPN, configure the VPN variables and apply
the Gluetun overlay:

```sh
docker compose -f compose.yml -f compose.gluetun.yml up --build
```

The overlay joins Transmission to Gluetun's network namespace and makes Bobarr
reach its RPC endpoint through Gluetun. A failed VPN health check prevents
Transmission from starting; after startup, Gluetun's firewall blocks peer
traffic if the tunnel drops.

See [Operations](./docs/operations.md) for backups, restore, permissions,
reverse proxies, and upgrades. See [Architecture](./docs/architecture.md) for
module boundaries and safety invariants.

## Security model

Bobarr supports one authenticated administrator. Passwords use Argon2id. Only a
hash of each session token is stored, cookies are HttpOnly and SameSite, and
CSRF tokens protect authenticated mutations. Connector secrets are encrypted at
rest with `/config/master.key` or `BOBARR_MASTER_KEY`. Tracker passkeys and
complete magnet query strings are never returned to the browser or written to
logs.

Treat `/config` and `/media` as sensitive. Put Bobarr behind HTTPS before
exposing it outside a trusted network.
