// Same-origin gate for mutating API routes. The loopback bind stops direct
// remote access, but the browser is a network relay into loopback: any
// webpage the user visits can fire cross-origin POSTs at 127.0.0.1:3000
// (CORS-simple requests land without a preflight). Cross-origin requests are
// rejected via the Origin header; requiring a loopback Host hostname is
// defense in depth. No Origin header (curl, scripts, healthchecks) passes,
// and same-origin usage is unaffected.

import { NextResponse } from 'next/server';

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

// Parse a JSON request body without throwing: handlers turn null into their
// 400 instead of repeating the identical try/catch in every route.
export async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// Uniform unexpected-error exit: the fixed label goes in the body (bodies
// render verbatim in UI badges), the real error goes to the server log.
export function routeError(err: unknown, label: string): NextResponse {
  console.error(`[route-error] ${label}:`, err);
  return NextResponse.json({ error: label }, { status: 500 });
}
