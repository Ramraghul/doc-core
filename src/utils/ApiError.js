/** An error that is safe to show to API clients. Anything else becomes a generic 500. */
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, code = 'BAD_REQUEST', details) {
    return new ApiError(400, code, message, details);
  }
  static validation(details) {
    return new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }
  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, code, message);
  }
  static forbidden(message = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    return new ApiError(403, code, message);
  }
  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new ApiError(404, code, message);
  }
  static conflict(message, code = 'CONFLICT') {
    return new ApiError(409, code, message);
  }
  static gone(message, code = 'GONE') {
    return new ApiError(410, code, message);
  }
  static tooLarge(message, code = 'PAYLOAD_TOO_LARGE') {
    return new ApiError(413, code, message);
  }
  static unsupportedMedia(message, code = 'UNSUPPORTED_MEDIA_TYPE') {
    return new ApiError(415, code, message);
  }
}

module.exports = ApiError;
