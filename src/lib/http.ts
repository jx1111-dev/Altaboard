// Same-origin gate for mutating API routes. The loopback bind stops direct
// remote access, but the browser is a network relay into loopback: any
// webpage the user visits can fire cross-origin POSTs at 127.0.0.1:3000
// (CORS-simple requests land without a preflight). Cross-origin requests are
// rejected via the Origin header; requiring a loopback Host hostname is
// defense in depth. No Origin header (curl, scripts, healthchecks) passes,
// and same-origin usage is unaffected.

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isSameOrigin(req: Request): boolean {
  const host = req.headers.get('host');
  if (!host) return false;

  let hostUrl: URL;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTNAMES.has(hostUrl.hostname.toLowerCase())) return false;

  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    // Malformed or "null" Origin (e.g. sandboxed frames) - reject.
    return false;
  }
}
