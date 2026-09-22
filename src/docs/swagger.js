const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const swaggerUi = require('swagger-ui-express');
const { Router } = require('express');

// Lives in public/ (not alongside this loader) so a single plain glob — "public/**" in vercel.json's
// `includeFiles` — is enough to bundle it for the Vercel deployment; express.static also happens to
// serve it directly at GET /openapi.yaml as a side effect, which is harmless (it isn't secret).
const specPath = path.join(__dirname, '..', '..', 'public', 'openapi.yaml');

/** Loaded once at startup. The OpenAPI file is the single source of truth for the API contract. */
const spec = YAML.parse(fs.readFileSync(specPath, 'utf8'));
spec.info.version = require('../../package.json').version;

function docsRouter() {
  const router = Router();
  router.get('/openapi.json', (_req, res) => res.json(spec));
  router.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: 'Docucore API',
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true, tryItOutEnabled: true },
    }),
  );
  return router;
}

module.exports = { docsRouter, spec };
