export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public errors: unknown[] = [],
  ) {
    super(message);
  }

  static badRequest(msg = "Bad request", errors: unknown[] = []) {
    return new ApiError(400, msg, errors);
  }
  static unauthorized(msg = "Unauthorized") {
    return new ApiError(401, msg);
  }
  static forbidden(msg = "Forbidden") {
    return new ApiError(403, msg);
  }
  static notFound(msg = "Resource not found") {
    return new ApiError(404, msg);
  }
  static conflict(msg = "Conflict", errors: unknown[] = []) {
    return new ApiError(409, msg, errors);
  }
}
