// Error taxonomy for Blizzard API calls. The worker treats each class
// differently (see client.ts + worker refresh loop).

export class BlizzardError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint?: string,
  ) {
    super(message);
    this.name = 'BlizzardError';
  }
}

// 404 - character/endpoint does not exist. Keep last snapshot, set lastFetchError.
export class NotFoundError extends BlizzardError {
  constructor(endpoint: string) {
    super('Not found', 404, endpoint);
    this.name = 'NotFoundError';
  }
}

// 401/403 - auth or data-unavailable. Classic endpoints 403 intermittently when data is unavailable.
export class AuthError extends BlizzardError {
  constructor(status: number, endpoint: string) {
    super('Auth error or data unavailable', status, endpoint);
    this.name = 'AuthError';
  }
}

// 429 - rate limited; back off.
export class RateLimitError extends BlizzardError {
  constructor(endpoint: string) {
    super('Rate limited', 429, endpoint);
    this.name = 'RateLimitError';
  }
}

// 5xx - transient; retry with jitter.
export class ServerError extends BlizzardError {
  constructor(status: number, endpoint: string) {
    super(`Server error ${status}`, status, endpoint);
    this.name = 'ServerError';
  }
}

// Compact one-line label for logs / snapshot _endpointErrors.
export function describeError(err: unknown): string {
  if (err instanceof BlizzardError) return `${err.status}: ${err.endpoint ?? ''}`.trim();
  return err instanceof Error ? err.message : String(err);
}
