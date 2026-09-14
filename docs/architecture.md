# Architecture

Bobarr is a single-replica modular monolith. One Bun process owns the HTTP
server, React assets, REST API, scheduled work, and SQLite connections. Jackett,
FlareSolverr, and Transmission remain isolated processes.

## Runtime boundaries

```text
Browser
  -> Bobarr / React + REST + SSE
       -> TMDB / optional OMDb
       -> Jackett -> configured indexers / FlareSolverr
       -> Transmission JSON-RPC
       -> /config/bobarr.sqlite + /config/jobs.sqlite
       -> /media/downloads, /media/movies, /media/tv
       -> optional extra volumes at /media-<disk-name>
```

The code is split into shared contracts, server modules, and the web app:

- `src/contracts` owns public request, response, error, and domain schemas.
- `src/server/domain` owns provider-independent acquisition decisions.
- `src/server/integrations` adapts TMDB, Jackett, and Transmission.
- `src/server/db` owns migrations and persistence repositories.
- `src/server/jobs` owns durable, idempotent background work.
- `src/server/library` owns safe organization and scanning.
- `src/web` is the responsive React client.

## Persistence and consistency

SQLite runs with foreign keys, WAL, and a busy timeout. Domain IDs are UUIDs;
Transmission's numeric torrent IDs never cross the public API. Long-running or
external side effects do not happen inside database transactions.

Work follows a durable-state pattern:

1. Commit the requested state and enqueue an idempotent job.
2. Perform the remote or filesystem side effect.
3. Commit the resulting durable state.
4. Reconcile nonterminal records on startup and at a short interval.

Downloads use `bobarr:{downloadId}` Transmission labels and the infohash as the
stable engine identity. Live progress remains in Transmission; Bobarr persists
only transitions and errors.

## Release acquisition

Jackett candidates are normalized, deduplicated, scored deterministically, and
cached for 30 minutes. Hard eligibility rules run before ranking. Automatic
acquisition only chooses an eligible top result. Manual search includes rejected
candidates and explanations, but browser-visible candidate IDs stay opaque so
tracker URLs and passkeys never round-trip through the client.

## Filesystem safety

Every source and destination is resolved and checked against configured roots.
Settings store a non-empty list of volumes. Each volume is a downloads, movies,
and television triple. Movie folders and TV seasons are the placement units.
New downloads use the unit's existing library or pending download volume.
A new unit uses the volume with the most available space after reservations.
Placement and download insertion are serialized so simultaneous episodes of a
new season choose the same volume.
Symlink traversal and malicious filenames are rejected. Organization is
restart-safe and records every produced file. Hardlink is the default and is
validated per volume. Imports queued before a placement change can copy across
filesystems to join their movie or season. The library records the actual
strategy. Partial failures preserve source data for a retry.

Settings queues `library.organize.v1` on a dedicated worker. It balances bytes
under the configured roots, including data that cannot move, and respects free
space on each destination filesystem. Shared torrent payloads join dependent
seasons into one transfer. The `volume_transfers` journal records staged copies,
checksums, published destinations, and the database commit before source cleanup.
Transmission uses the verified destination payload before the old data is
removed. Interrupted transfers resume from their journal. Downloads and scans
for unrelated media continue while the transfer runs.

Library scans import only uniquely identified titles. Ambiguous folders become
durable `library_scan_reviews` records containing the scanned files and a
bounded set of TMDB candidate summaries. Resolution requires an explicit
candidate, revalidates every recorded path against a current root of the same
kind, and uses idempotent media/file upserts so it can safely resume after a
restart.
