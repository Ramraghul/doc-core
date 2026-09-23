/* Initializes Swagger UI against our own spec endpoint. Kept as its own file (not an inline <script> in
   index.html) so it satisfies this app's CSP (script-src 'self'; no 'unsafe-inline'). */
window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'StandaloneLayout',
    deepLinking: true,
    persistAuthorization: true,
    displayRequestDuration: true,
    tryItOutEnabled: true,
  });
};
