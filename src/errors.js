export const EXIT_OK = 0;
export const EXIT_API = 1;
export const EXIT_USAGE = 2;
export const EXIT_AUTH = 3;

/** A mistake in how the command was called: bad flag, missing argument, malformed ID. Exit code 2. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = EXIT_USAGE;
  }
}

/** No usable credentials, or the portal refused the key. Exit code 3. */
export class AuthError extends Error {
  constructor(message, code = 'unauthenticated') {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.exitCode = EXIT_AUTH;
  }
}

/** The portal answered with an error, or could not be reached. Exit code 1 (3 for HTTP 401). */
export class ApiError extends Error {
  constructor(code, message, status = 0, fields = undefined) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.exitCode = status === 401 || code === 'unauthenticated' ? EXIT_AUTH : EXIT_API;
  }
}
