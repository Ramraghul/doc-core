/**
 * Copies the Swagger UI static assets this app actually needs from swagger-ui-dist (a devDependency)
 * into public/vendor/swagger-ui/, which is what public/api-docs/index.html references and what
 * actually ships to every deployment target (see src/docs/swagger.js for why: swagger-ui-express's own
 * asset delivery relies on a runtime directory scan that Vercel's build-time bundler can't see, so those
 * files silently never made it into a real deployment there).
 *
 * Run after bumping the swagger-ui-dist version:  npm run vendor:swagger-ui
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.dirname(require.resolve('swagger-ui-dist/package.json'));
const DEST = path.join(__dirname, '..', 'public', 'vendor', 'swagger-ui');
const FILES = ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js', 'favicon-32x32.png', 'favicon-16x16.png'];

fs.mkdirSync(DEST, { recursive: true });
for (const file of FILES) fs.copyFileSync(path.join(SRC, file), path.join(DEST, file));

const { version } = require('swagger-ui-dist/package.json');
console.log(`Vendored swagger-ui-dist@${version}: ${FILES.join(', ')} -> public/vendor/swagger-ui/`);
