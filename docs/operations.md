# Operations

## Files and permissions

Bobarr, Jackett, and Transmission run as the configured `PUID:PGID` rather than
root. FlareSolverr's image has its own non-root runtime user. The same host
identity must be able to create files below every mounted configuration and
media root. Gluetun is the deliberate exception: creating the tunnel and its
fail-closed firewall requires `NET_ADMIN` and `/dev/net/tun`.

The LinuxServer containers receive an executable `/run` tmpfs owned by the same
UID/GID. This is required by their s6 supervisor when `user` and
`no-new-privileges` are both enabled; do not remove those mounts when
customizing Compose.

On Linux, set `PUID=$(id -u)` and `PGID=$(id -g)` in `.env`, create the mount
directories before the first start, and verify ownership:

```sh
mkdir -p config/jackett config/transmission media/downloads media/movies media/tv
stat -c '%u:%g %n' config config/jackett config/transmission media
```

```text
/config
  bobarr.sqlite
  jobs.sqlite
  master.key
  backups/
/media
  downloads/
  movies/
  tv/
```

For hardlinks, `downloads`, `movies`, and `tv` must be on one filesystem and be
presented through the single `/media` container mount. Do not mount each child
from a different host filesystem.

## Master key

When `BOBARR_MASTER_KEY` is absent, Bobarr creates `/config/master.key` with
restrictive permissions. Back it up separately from the SQLite files. If an
explicit environment key is used, store the 32-byte base64 value in a secrets
manager. Losing the key makes encrypted connector credentials unrecoverable.

## Backups and restore

Scheduled backups serialize a transactionally consistent SQLite image rather
than copying a live WAL database. Each image is opened and checked with
`PRAGMA integrity_check` before it is atomically renamed into
`/config/backups`. The retention count is configurable in Settings (14 by
default) and is applied independently to application and job queue images.
Keep an off-host copy of the backup directory and master key.

The authenticated Settings screen lists only application images that pass both
SQLite integrity and Bobarr migration-history validation. To restore an
application image:

1. Select the `.sqlite` image in Settings → Maintenance and type the explicit
   confirmation. Bobarr caps the upload and stages it at an application-owned,
   fixed path; the live database is not changed by the request.
2. Preserve the `master.key` that encrypted the image's connector secrets. A
   database from another installation needs that installation's matching key.
3. Restart Bobarr. Before opening the normal database, Bobarr validates the
   staged image again and creates timestamped `bobarr-pre-restore-*` and
   `jobs-pre-restore-*` rollback snapshots in `/config/backups`.
4. Bobarr atomically installs the application image and starts with a fresh job
   queue. Startup reconciliation recreates nonterminal work from the restored
   durable download and library state.
5. Check System diagnostics and run download reconciliation before resuming
   normal use.

If startup fails after a restore, stop Bobarr, preserve `/config`, then copy the
newest `bobarr-pre-restore-*` image to `/config/bobarr.sqlite` and the matching
`jobs-pre-restore-*` image to `/config/jobs.sqlite`. Remove the corresponding
`-wal` and `-shm` sidecars while Bobarr is stopped, verify ownership, and start
again. Never upload or copy a database while Bobarr has it open.

Startup reconciliation is expected to recover nonterminal jobs and associate
Bobarr downloads with Transmission by label and infohash.

## Graceful shutdown

On `SIGTERM` or `SIGINT`, Bobarr immediately fails readiness, stops scheduling
and claiming background work, closes SSE streams, and stops accepting new HTTP
connections. It then lets active HTTP requests and the current durable job
finish before closing the job and application SQLite databases. The shared
deadline defaults to 15 seconds and can be set with
`BOBARR_SHUTDOWN_TIMEOUT_MS` (1–300000 milliseconds). If it expires, Bobarr
force-closes remaining HTTP connections, aborts active connector/filesystem
work, and closes its databases; the durable lease is recovered on the next
startup. Keep this value below Compose's `stop_grace_period`, which is 30
seconds in the provided stack.

## Reverse proxy

Terminate TLS at a reverse proxy and forward the original `Host`,
`X-Forwarded-Proto`, and client address. Keep SSE response buffering disabled
for `/api/v1/events`, use a long read timeout, and allow request bodies up to
512 MiB on `/api/v1/system/restore` if large database restores are needed.
Bobarr applies its own streaming restore cap, limits ordinary API bodies to 1
MiB and torrent metainfo to 10 MiB plus multipart framing, and keeps SSE
connections exempt from Bun's normal idle timeout. API responses allow
cross-origin access from any origin. Authenticated mutations remain protected by
the session's CSRF token.

The Compose stack defaults `BOBARR_COOKIE_SECURE` to `false` so sessions work
when Bobarr is opened directly over HTTP, including through a private Tailscale
IP. Set it to `true` whenever clients reach Bobarr over HTTPS. After changing
this setting, recreate the Bobarr container and sign in again so the browser
receives a new session cookie.

Only publish Bobarr beyond the host. The provided stack binds Transmission's
authenticated Web UI/RPC to `127.0.0.1:9091` for local diagnostics and Jackett's
setup UI to loopback; FlareSolverr has no host port. Never change either
diagnostic binding to `0.0.0.0` or route it through the public reverse proxy.

## Offline administrator reset

Stop Bobarr, then pass a new password through standard input inside a one-off
container. Password command-line arguments are deliberately unsupported:

```sh
printf '%s\n' 'a-new-long-password' | docker compose run --rm --no-deps -T bobarr \
  bun run admin:reset -- --database /config/bobarr.sqlite --password-stdin
```

The reset revokes every existing session and clears login throttling. Start
Bobarr again and sign in with the new password.

## Upgrades

1. Read release notes and take a verified backup.
2. Pull/build the new image while the old container is still available.
3. Stop Bobarr and replace the container without deleting `/config` or `/media`.
4. Bobarr applies forward-only checked-in migrations at startup.
5. Verify readiness, integrations, queued jobs, and a sample library path.

Images are pinned by immutable digest. Dependency automation proposes updates;
review release and security notes before accepting new digests.

The checked-in pins currently identify Bun 1.3.14, Jackett
v0.24.2251-ls468, FlareSolverr v3.5.0, Transmission 4.1.3-r0-ls355, and
Gluetun v3.40.0. Keep the readable version tag and digest together when
updating an image so operators can audit both intent and exact content.
Source installs build the versioned `bobarr-v2:0.1.0` application image. For a
released deployment, set `BOBARR_IMAGE` to the GHCR version plus the digest
emitted by the release workflow.

## Gluetun

The optional overlay routes only Transmission through Gluetun. Jackett and
FlareSolverr keep ordinary networking so tracker discovery is independent of
the BitTorrent privacy boundary. Verify your provider settings and Gluetun
health before acquiring content. Transmission has no independent network in
the merged Compose model: it shares Gluetun's namespace and waits for Gluetun's
image health check. If the tunnel later drops, Gluetun's firewall keeps the
namespace fail-closed even though Docker does not automatically stop an already
running dependent container.

The overlay resets Transmission's inherited host port and publishes loopback
9091 on Gluetun instead. This is required because a container using
`network_mode: service:gluetun` cannot publish its own ports. Keep custom port
mappings on Gluetun and preserve the loopback host address.

Simulate a tunnel loss during commissioning and confirm peer traffic stops
while Bobarr reports Transmission as degraded. Restore the tunnel and confirm
download reconciliation resumes without creating a duplicate torrent.

## Deployment verification

CI runs `.github/scripts/verify-compose.ts` against the base and merged VPN
models. The check requires Transmission diagnostics and Jackett's UI to bind to
loopback, rejects any FlareSolverr host port, and checks unpinned service images,
divergent media mounts, root application users, and an overlay that leaves
Transmission on a direct network. In the VPN model, Gluetun owns the loopback
9091 publication because Transmission shares its network namespace. The weekly
Compose smoke workflow also boots the base stack, probes health and exposure,
checks mounted-directory permissions, restarts the stateful services, and
proves the shared media tree supports hardlinks.

The same workflow runs its Gluetun job on the weekly schedule and on manual
dispatch whenever VPN test credentials are configured. Set
`GLUETUN_VPN_SERVICE_PROVIDER`, `GLUETUN_WIREGUARD_PRIVATE_KEY`,
`GLUETUN_WIREGUARD_ADDRESSES`, and optionally `GLUETUN_SERVER_COUNTRIES` as
repository secrets to exercise real VPN egress and verify that stopping Gluetun
removes Transmission's public egress. Without those secrets, the VPN job exits
cleanly after reporting that the live tunnel check was skipped.

For each new host, also perform a live commissioning check:

1. Wait for `docker compose ps` to report every service healthy.
2. Confirm `/health/ready` succeeds through Bobarr's published port.
3. Confirm the authenticated Transmission UI on 9091 and Jackett on 9117 are
   reachable only through loopback, and port 8191 is unreachable from the host.
4. Restart Bobarr and Transmission, then confirm the same download is adopted
   by label/infohash rather than duplicated.
5. Organize a small test file and confirm its source and library copy have the
   same inode when hardlink mode is selected.
