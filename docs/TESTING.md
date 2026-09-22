# Testing

166 automated checks (156 documented cases — the `it.each` ones expand to several runs) run in about 10 seconds.
The complete list, generated from the test titles, is in **[TEST_CASES.md](TEST_CASES.md)**.

## Run them

```bash
npm install
npm test                  # everything (unit + integration)
npm run test:coverage     # + coverage report; fails below the configured thresholds
npm run lint
npm run docs:tests        # regenerate docs/TEST_CASES.md after adding/renaming tests
npx jest tests/integration/versions.test.js -t "VER-08"     # one file / one case
```

You do **not** need to install or start MongoDB: `mongodb-memory-server` launches a throw-away instance for the run
(`tests/helpers/globalSetup.js`) and every Jest worker gets its own database, so suites can run in parallel without
seeing each other’s data. The first run downloads a `mongod` binary; to reuse one you already have:

```bash
MONGOMS_SYSTEM_BINARY=/usr/bin/mongod npm test
```

(A “possible version conflict” warning from the memory server in that case is harmless.)

## Strategy

| Layer | What it proves | Where |
| --- | --- | --- |
| **Unit** | Pure logic in isolation: file-type sniffing, filename sanitising, Zod schemas, the permission model, serialisers, small utilities | `tests/unit/` |
| **Integration** | The **real Express app** (`createApp()`) driven over HTTP with Supertest against a **real MongoDB** — routes, middleware order, auth, permissions, GridFS, error format | `tests/integration/` |
| **Contract** | The OpenAPI document is valid OpenAPI 3 (validated by `swagger-parser`), every non-public operation declares bearer security, and Swagger’s pre-filled form values can’t silently filter results | `SYS-20`, `SYS-22`, `SYS-25` |

Guiding principles:

1. **No database mocks.** Mongoose behaviour (unique indexes, atomic updates, GridFS, `populate`) is exactly where bugs hide, so
   tests use the real thing. The only mocks are for failures that can’t be produced naturally (database down, an unexpected exception).
2. **Test through the public API**, then assert on side effects that matter (blobs in GridFS, audit entries, quota) — not on
   private functions.
3. **Every test title starts with an ID** (`AUTH-07`, `VER-08`…). The IDs are what `ARCHITECTURE.md` cites as evidence, and
   `npm run docs:tests` turns them into the matrix. CI fails if `TEST_CASES.md` is out of date.
4. **Abuse cases are first-class**: NoSQL-operator payloads, executables renamed `.pdf`, forged/`alg:none` JWTs, path-traversal filenames,
   regex metacharacters in search, oversize bodies, rate-limit bursts, five concurrent uploads.
5. **Each test owns its data**: `beforeEach` empties the database and creates fresh users through the real registration endpoint.

## What is covered

| Area | Cases | Highlights |
| --- | ---: | --- |
| Authentication | 14 | duplicate/normalised emails, enumeration-safe login, bcrypt storage, expired/forged tokens, deleted user, live role changes |
| Documents | 26 | upload validation, MIME/content mismatch, unicode names, pagination without gaps, partial/case-insensitive search, regex-safe search, filters/sorts, edit rules, audit trail |
| Versions & downloads | 13 | exact-bytes downloads, old versions, duplicate detection, retention pruning + storage cleanup, **concurrent uploads**, RFC 5987 filenames, missing-blob handling |
| Sharing & public links | 19 | viewer/editor/owner matrix, revocation, stranger = 404 on every route, hashed tokens, expiry, revoke/replace, trash interaction, always-newest |
| Trash | 9 | soft delete, collaborator invisibility, two-step permanent delete, quota release, purge by age, audit outlives document |
| Limits | 6 | max file size, per-user quota, quota charged to owner for editors’ uploads, JSON body cap |
| Admin & bootstrap | 7 | stats/users, 403 for non-admins, no implicit document access, idempotent admin/demo seeding |
| System | 19 | health (ok/503), JSON 404, request-ids, security headers, generic 500, CORS, rate limiting, OpenAPI validity, Swagger “Try it out” has no hidden filters, static UI, `/config`, DB connection reuse across invocations |
| Cron / scheduler endpoint | 5 | disabled without a secret configured, rejects missing/wrong secret, works with no user JWT, actually purges, unaffected by other middleware |
| Unit | 38 | see [TEST_CASES.md](TEST_CASES.md) |

Coverage at the time of writing: **96 % statements · 86 % branches · 95 % functions · 98 % lines**. `jest.config.js` enforces
minimums (85 / 70 / 85 / 85) so coverage can’t silently rot. What is *not* covered: `server.js` (process bootstrap,
verified manually — including `SIGTERM` shutdown), and rarely-hit defensive branches in the config loader and error mapper.

## Adding a test

1. Pick the area file (or create one) and add `it('AREA-NN what should happen', …)` with the next free number.
2. Build state with `createUser(app)` and `user.upload()`; make requests with `user.get/post/patch/del(url)` (they carry the token).
   Use `files.pdf()/png()/text()/exe()` for tiny files whose magic numbers are valid (or deliberately invalid).
3. `npm run docs:tests` and commit the regenerated matrix.

Limits and other settings are read from `src/config/env.js` **at request time**, so a test can tighten them and restore
them in `finally` (see `LIM-01`, `VER-07`). Rate limiters are built when the app is created, so rate-limit tests set the
config first and then call `createApp()` (see `SYS-10`).

## Gotchas worth knowing (found while building this)

- **MongoDB driver 7.6 inside Jest.** The driver resolves OS info with a dynamic `import('os')`, which Jest’s VM sandbox
  can’t execute, so the server rejects the handshake with *“Missing required sub-document 'driver'”*. `src/config/db.js`
  passes `runtimeAdapters: { os }` explicitly — the driver’s supported workaround, harmless in production.
- **Express 5 query parsing** no longer builds nested objects from `q[$ne]=x`, so that syntax is an ignored unknown parameter
  rather than a validation error; `DOC-28` asserts the operator is *never applied*, and `UT-VAL-10` covers object values at the
  schema level.
- **`swagger-parser` v10** is used (CommonJS) because v13 is ESM-only and Jest can’t load it.
- Latin-1 filenames (`résumé.pdf`) legitimately appear as plain quoted strings in `Content-Disposition`; only characters outside
  Latin-1 (`履歴書.pdf`) need the RFC 5987 `filename*=` form (`VER-09` covers both).

## Manual checklist (the web UI has no automated browser tests)

The API behind every UI action is covered above. The UI itself was exercised by hand (in a real browser, desktop and
375 px phone width) with the script below; **re-run it before a release** — ticked = verified at the time of writing.

- [x] Sign in with the demo account → sample documents appear
- [x] Register: a weak password shows the server’s message; a strong one signs in to an empty library
- [x] Search (“budg”), click a tag chip, clear it, change sort order, paginate (12 documents → 2 pages)
- [x] Upload with title/tags → appears at top (also a real 600 KB PNG as a new version, downloaded back)
- [x] Open a document → edit title/tags → save (tags normalised); upload a new version with a comment → history shows v2 “current”; download buttons produce files named after each version
- [x] Sharing: share with a second account as viewer → in *their* “Shared with me”, read-only (no Sharing tab, trash or save controls, inputs disabled)
- [x] Create a public link → the URL downloads anonymously with `attachment` + `nosniff` (checked with curl); the token is shown once
- [x] Activity tab lists each action; trash → appears in Trash → Restore; trash → Delete forever
- [x] Phone-width layout (375 px): nav scrolls horizontally, list stays readable
- [x] `/api-docs` renders under the strict CSP with a clean console; **Authorize** + **Try it out** on `GET /documents` returns data (this caught the `SYS-25` bug)
- [ ] Revoking a link and viewing the public link in a private window (covered by API tests `SHR-23/25`, not clicked through)

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR: install → lint → tests with coverage gate → verify `TEST_CASES.md` is
current → build the Docker image.
