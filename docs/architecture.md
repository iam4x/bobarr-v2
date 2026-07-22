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
Symlink traversal and malicious filenames are rejected. Organization is
restart-safe and records every produced file. Hardlink is the default; a
cross-filesystem hardlink error is surfaced and never silently becomes a copy.
Partial failures preserve the source data for an explicit retry.

Library scans import only uniquely identified titles. Ambiguous folders become
durable `library_scan_reviews` records containing the scanned files and a
bounded set of TMDB candidate summaries. Resolution requires an explicit
candidate, revalidates every recorded path against the current configured root,
and uses idempotent media/file upserts so it can safely resume after a restart.
