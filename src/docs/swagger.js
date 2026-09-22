const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const swaggerUi = require('swagger-ui-express');
const { Router } = require('express');

const specPath = path.join(__dirname, 'openapi.yaml');

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
