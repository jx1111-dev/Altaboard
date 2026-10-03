// Shared reader for a fetch response's error body: a proxy or HTML error page
// has no JSON, so res.json() is never trusted raw - the `error` field is used
// only when it is a string, else the caller's fixed fallback label.

export async function responseErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === 'string' ? body.error : fallback;
}
