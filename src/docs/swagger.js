const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { Router } = require('express');

// Lives in public/ (not alongside this loader) so a single plain glob — "public/**" in vercel.json's
// `includeFiles` — is enough to bundle it for the Vercel deployment; express.static also happens to
// serve it directly at GET /openapi.yaml as a side effect, which is harmless (it isn't secret).
const specPath = path.join(__dirname, '..', '..', 'public', 'openapi.yaml');

/** Loaded once at startup. The OpenAPI file is the single source of truth for the API contract. */
const spec = YAML.parse(fs.readFileSync(specPath, 'utf8'));
spec.info.version = require('../../package.json').version;

/**
 * Swagger UI itself is a hand-written static page (public/api-docs/index.html + init.js), not generated
 * by swagger-ui-express's swaggerUi.setup(). That library's HTML template hardcodes relative asset URLs
 * (./swagger-ui-bundle.js etc.), served via express.static() scanning swagger-ui-dist's folder by
 * filename at request time — a directory listing serverless bundlers can't predict statically, so those
 * files silently never made it into a real Vercel deployment (confirmed live: requests to
 * swagger-ui-bundle.js returned 200 with the Swagger *page* HTML instead of the script). The static page
 * only references files vendored into public/vendor/swagger-ui/, which deploy like any other public/
 * file (already proven — see openapi.yaml above). express.static (mounted in src/app.js) serves
 * public/api-docs/index.html for GET /api-docs/ automatically; this router only needs to provide the
 * machine-readable spec.
 */
function docsRouter() {
  const router = Router();
  router.get('/openapi.json', (_req, res) => res.json(spec));
  return router;
}

module.exports = { docsRouter, spec };
