/**
 * Domain-level errors. Services throw these; the problem-details filter turns them into
 * RFC 9457 responses. Nothing below the HTTP layer knows about status codes except here.
 */
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  readonly errors?: { path: string; message: string }[];

  protected constructor(message: string, errors?: { path: string; message: string }[]) {
    super(message);
    this.name = new.target.name;
    if (errors) this.errors = errors;
  }
}

/**
 * The single "not found" of the system. Returned identically whether the row does not exist or
 * belongs to another tenant (T11, ADR-008): with RLS the two are indistinguishable anyway.
 */
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = 'NOT_FOUND';
  constructor(
    readonly entityType: string,
    readonly entityId?: string,
  ) {
    super('The requested resource was not found');
  }
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  constructor(
    readonly code: string = 'UNAUTHENTICATED',
    message = 'Authentication is required',
  ) {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  constructor(
    readonly code: string = 'FORBIDDEN',
    message = 'You are not allowed to perform this action',
  ) {
    super(message);
  }
}

export class ConflictError extends AppError {
  readonly status = 409;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** A well-formed request that breaks a business rule (e.g. an illegal state transition). */
export class BusinessRuleError extends AppError {
  readonly status = 422;
  constructor(
    readonly code: string,
    message: string,
    errors?: { path: string; message: string }[],
  ) {
    super(message, errors);
  }
}

export class ValidationFailedError extends AppError {
  readonly status = 400;
  readonly code = 'VALIDATION_FAILED';
  constructor(errors: { path: string; message: string }[], message = 'The request is invalid') {
    super(message, errors);
  }
}

export class TooManyRequestsError extends AppError {
  readonly status = 429;
  readonly code = 'RATE_LIMITED';
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests, slow down');
  }
}
