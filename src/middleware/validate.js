const ApiError = require('../utils/ApiError');

/**
 * validate({ params, query, body }) — parses each part with its Zod schema.
 * Parsed (coerced, trimmed, defaulted) values are placed on `req.valid`; handlers must use those,
 * never the raw `req.body` / `req.query`. This is also our NoSQL-injection guard: a payload like
 * `{"email": {"$ne": null}}` is not a string, so it is rejected before it can reach a query.
 * (Express 5 makes `req.query` read-only, which is why we do not overwrite it.)
 */
const validate = (schemas) => (req, _res, next) => {
  const valid = {};
  const details = [];

  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (result.success) {
      valid[part] = result.data;
    } else {
      for (const issue of result.error.issues) {
        details.push({ in: part, path: issue.path.join('.'), message: issue.message });
      }
    }
  }

  if (details.length) return next(ApiError.validation(details));
  req.valid = valid;
  next();
};

module.exports = validate;
