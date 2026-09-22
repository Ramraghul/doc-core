# 🗂 Docucore — Document Management API

A production-style **document management service**: upload files, keep every version, share with people or by
expiring public link, search, recover from the trash, and audit everything — behind a documented REST API, a small
web UI, and a test suite you can read like a spec.

Built with **Node.js 22 · Express 5 · MongoDB (GridFS) · JWT · Zod · Swagger/OpenAPI 3 · Jest**.
Designed to run **free, indefinitely** on Render + MongoDB Atlas (recommended), with an adapted path for Vercel
serverless functions too (see [Deployment](docs/DEPLOYMENT.md)).

| | |
| --- | --- |
| **Live demo** | `https://<your-service>.onrender.com` &nbsp;·&nbsp; UI at `/` &nbsp;·&nbsp; Swagger at `/api-docs` &nbsp;·&nbsp; health at `/health` |
| **Tests** | 166 automated checks (156 documented cases) · ~96 % statement coverage — [test-case matrix](docs/TEST_CASES.md) |
| **Docs** | [Architecture](docs/ARCHITECTURE.md) · [Deployment](docs/DEPLOYMENT.md) · [Testing](docs/TESTING.md) · [API spec](src/docs/openapi.yaml) |

> Replace the demo URL above after you deploy. The API, UI, Swagger docs and production-mode startup were all
> exercised locally against a real MongoDB; the cloud deployment itself and the Docker image build are the parts
> you run on your own accounts/machine (steps below).

---

## Features

**Documents**
- Upload PDF, images, Office files, text/Markdown/CSV/JSON, ZIP (type allow-list **plus magic-number content check**)
- **Full version history**: each upload is an immutable version with a SHA-256 checksum; download any version
- Byte-identical re-uploads are rejected; a retention policy keeps the newest *N* versions
- Titles, descriptions, tags; **search** (title/description/tags/filename), tag & type filters, sorting, pagination
- **Trash → restore → permanent delete**, with automatic purge after a retention window

**Collaboration**
- Share by email as **viewer** or **editor**; owners see who has access and can revoke instantly
- **Expiring public links** (1 hour – 30 days), revocable, token stored only as a hash
- Per-document **audit trail** (created, edited, version added, downloaded, shared, link created, trashed…)

**Platform**
- JWT authentication, bcrypt passwords, roles (`user`, `admin`), per-user **storage quota**
- Consistent JSON errors with a `requestId`, structured logs, health check that pings the database
- Rate limiting, Helmet security headers, strict CSP, CORS allow-list, input validation on every route
- OpenAPI 3 spec served as interactive **Swagger UI**; a dependency-free **web UI** (no build step)

## Quick start (local)

Requirements: **Node ≥ 20.12** and a MongoDB (local install, Docker, or a free Atlas cluster).

```bash
git clone <your-repo-url> docucore && cd docucore
npm install
cp .env.example .env          # then edit MONGODB_URI / JWT_SECRET (see Configuration)

# no local MongoDB? one line with Docker:
docker run -d --name mongo -p 27017:27017 mongo:7

npm run dev                   # http://localhost:3000  (pretty logs, auto-restart)
```

Set `DEMO_EMAIL` + `DEMO_PASSWORD` in `.env` to get a ready-made account with sample documents
(the UI then shows a **“Try the demo account”** button), and `ADMIN_EMAIL` + `ADMIN_PASSWORD` for an administrator.

| Open | What you get |
| --- | --- |
| `http://localhost:3000/` | Web UI — sign in, upload, version, share, trash |
| `http://localhost:3000/api-docs` | Swagger UI — try every endpoint (click **Authorize**, paste your JWT) |
| `http://localhost:3000/openapi.json` | Raw OpenAPI 3 document |
| `http://localhost:3000/health` | `{"status":"ok","db":"up",…}` |

### Five-minute API tour (curl)

```bash
API=http://localhost:3000/api/v1

# 1. register (returns a JWT) and keep the token
TOKEN=$(curl -s $API/auth/register -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","password":"Str0ngPassw0rd"}' | jq -r .token)

# 2. upload a document (multipart; field name "file")
DOC=$(curl -s $API/documents -H "authorization: Bearer $TOKEN" \
  -F file=@report.pdf -F tags="finance,2026" | jq -r .document.id)

# 3. upload version 2, then list the history
curl -s $API/documents/$DOC/versions -H "authorization: Bearer $TOKEN" -F file=@report-v2.pdf -F comment="Legal edits"
curl -s $API/documents/$DOC/versions -H "authorization: Bearer $TOKEN" | jq '.versions[] | {version,filename,size,isCurrent}'

# 4. download version 1
curl -s "$API/documents/$DOC/download?version=1" -H "authorization: Bearer $TOKEN" -o v1.pdf

# 5. share with a colleague, and create a 24 h public link
curl -s $API/documents/$DOC/shares -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"email":"grace@example.com","permission":"editor"}'
curl -s $API/documents/$DOC/public-link -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"expiresInHours":24}' | jq .

# 6. search, then move to trash and restore
curl -s "$API/documents?q=report&tag=finance" -H "authorization: Bearer $TOKEN" | jq '.data[].title'
curl -s -X DELETE $API/documents/$DOC -H "authorization: Bearer $TOKEN"
curl -s -X POST   $API/documents/$DOC/restore -H "authorization: Bearer $TOKEN" | jq .document.deletedAt
```

## API at a glance

Base path `/api/v1` · full contract in [`src/docs/openapi.yaml`](src/docs/openapi.yaml) (browse it at `/api-docs`).

| Area | Endpoints |
| --- | --- |
| **Auth** | `POST /auth/register` · `POST /auth/login` · `GET /auth/me` (user + storage usage) |
| **Documents** | `POST /documents` · `GET /documents` (`q`, `tag`, `mimeType`, `scope`, `sort`, `order`, `page`, `limit`) · `GET/PATCH /documents/{id}` · `GET /documents/{id}/activity` |
| **Versions** | `GET/POST /documents/{id}/versions` · `GET /documents/{id}/download?version=n` |
| **Sharing** | `POST /documents/{id}/shares` · `DELETE /documents/{id}/shares/{userId}` · `POST/DELETE /documents/{id}/public-link` |
| **Trash** | `DELETE /documents/{id}` (to trash) · `POST /documents/{id}/restore` · `DELETE /documents/{id}/permanent` · `GET /documents?scope=trash` |
| **Public** | `GET /public/{token}` · `GET /public/{token}/download` (no auth) |
| **Admin** | `GET /admin/stats` · `GET /admin/users` · `POST /admin/purge-trash` |
| **System** | `GET /health` · `GET /api/v1/config` (public limits for the UI) |

Errors always have one shape, so clients need a single handler:

```json
{ "error": { "code": "DOCUMENT_NOT_FOUND", "message": "Document not found", "requestId": "5f0f3c6e-…" } }
```

## Configuration

All settings are environment variables (validated at startup with Zod; the server refuses to boot with a bad config).
Copy [`.env.example`](.env.example) for local development. On a host, set them in its dashboard.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/docucore` | MongoDB / Atlas connection string |
| `JWT_SECRET` | dev-only fallback | **Required in production**, ≥ 32 random chars |
| `JWT_EXPIRES_IN` | `8h` | Token lifetime |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost |
| `MAX_FILE_SIZE_MB` | `10` | Largest single upload |
| `USER_QUOTA_MB` | `50` | Storage per user (all versions; trash counts until purged) |
| `MAX_VERSIONS_PER_DOCUMENT` | `20` | Retention: newest N versions kept |
| `TRASH_RETENTION_DAYS` | `30` | Days in trash before automatic purge |
| `CORS_ORIGINS` | *(empty = same-origin only)* | Comma-separated allowed browser origins |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | – | Create/promote an admin on startup |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | – | Create a public demo account with sample docs |
| `CRON_SECRET` | – | Vercel deployments only — enables `GET /api/v1/internal/purge-trash` (see [docs/DEPLOYMENT.md#alternative-vercel](docs/DEPLOYMENT.md#alternative-vercel)) |
| `PORT` · `LOG_LEVEL` · `NODE_ENV` | `3000` · `info` · `development` | Runtime |

## Project structure

```
src/
  app.js               Express app factory (middleware order, /health, static UI, routes)
  server.js            Process bootstrap: DB connect, seed, listen, purge timer, graceful shutdown
  config/              env.js (validated config) · db.js (Mongo connection)
  routes/              Thin HTTP layer: validate → call service → shape response
  services/            All business rules: documents, auth, usage/quota, audit, admin, bootstrap
  models/              Mongoose schemas: User, Document (embedded versions), AuditLog
  storage/gridfs.js    The only file that knows where bytes live (swap for S3 here)
  middleware/          auth, validate (Zod), upload (multer + sniffing), rate limit, error handler
  validators/          Zod schemas for every request
  utils/               ApiError, file-type sniffing, streaming download, pagination, logger
  docs/                openapi.yaml + Swagger UI mount
public/                Dependency-free web UI (index.html, app.js, styles.css)
api/index.js           Vercel serverless entrypoint (wraps the same app; see docs/DEPLOYMENT.md#vercel)
tests/                 unit/ + integration/ (real Express app, real MongoDB) + helpers/
docs/                  ARCHITECTURE · DEPLOYMENT · TESTING · TEST_CASES (generated)
Dockerfile · render.yaml · vercel.json · .github/workflows/   Deploy + CI
```

## Testing

```bash
npm test                 # 166 checks, ~10 s (spins up a throw-away MongoDB automatically)
npm run test:coverage    # + coverage report and threshold gate
npm run lint
npm run docs:tests       # regenerate docs/TEST_CASES.md from the test titles
```

Tests run the **real Express app against a real MongoDB** (no database mocks), covering happy paths, permission
boundaries, abuse cases (NoSQL injection, disguised executables, forged JWTs, path traversal), concurrency, limits,
and the OpenAPI document itself. Details: [docs/TESTING.md](docs/TESTING.md) · matrix: [docs/TEST_CASES.md](docs/TEST_CASES.md).

## Deployment (free)

**Render** (web service) + **MongoDB Atlas M0** (database *and* file storage via GridFS) — no credit card, no expiry
on either free tier. Step-by-step instructions, keep-alive setup and honest caveats about what
“free forever” does and doesn’t guarantee: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. A `Dockerfile` is included
for any other container host, and an adapted **Vercel** path (`api/index.js`, `vercel.json`) is documented with its
trade-offs (upload-size cap, execution limits, connection pooling) in [docs/DEPLOYMENT.md#alternative-vercel](docs/DEPLOYMENT.md#alternative-vercel).

## Security highlights

Every claim below is backed by a test ID in [docs/TEST_CASES.md](docs/TEST_CASES.md); the full threat table is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-model).

- Passwords: bcrypt; login errors and timing don’t reveal whether an email exists
- JWT pinned to HS256 + issuer; the user is re-loaded on every request, so role changes and deletions apply immediately
- Zod validation on all input → operator objects like `{"$ne":null}` never reach a query; search text is regex-escaped
- Uploads: allow-list + magic-number check; served only as attachments with `nosniff`; no HTML/SVG/executables
- Documents you can’t access return **404**, not 403 — existence isn’t leaked; admins have **no** implicit read access
- Public-link tokens: 256-bit random, only the hash is stored, expiring, revocable

## Known limitations (deliberate scope for a portfolio project)

- Uploads are buffered in memory (bounded by `MAX_FILE_SIZE_MB`) rather than streamed — right for small free instances, not for multi-GB files.
- One JWT per login (no refresh tokens / server-side logout list); no email flows, so **no password reset**.
- Search is substring matching on metadata, not full-text search of file contents.
- No antivirus scanning; the in-process trash purge only runs while the server is awake (an admin endpoint covers the rest).
- Rate-limit counters are in memory (fine for one instance; use a shared store to scale out).

## License

MIT — see [LICENSE](LICENSE).
