// Pins the same-origin gate (lib/http isSameOrigin) that guards every
// mutating API route: no Origin header passes (curl, scripts, healthchecks),
// the Host must be a loopback hostname, and the Origin must match the Host
// exactly (host:port). Requests are duck-typed to { headers } because undici
// drops Host/Origin as forbidden headers on a real Request; isSameOrigin only
// reads req.headers.

import { describe, expect, it } from 'vitest';
import { isSameOrigin } from '@/lib/http';

function reqWith(headers: Record<string, string>): Request {
  return { headers: new Headers(headers) } as unknown as Request;
}

const cases: { name: string; headers: Record<string, string>; ok: boolean }[] = [
  {
    name: 'passes with no Origin header (curl, scripts, healthchecks)',
    headers: { host: 'localhost:3000' },
    ok: true,
  },
  {
    name: 'passes same-origin on localhost',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    ok: true,
  },
  {
    name: 'passes same-origin on 127.0.0.1',
    headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
    ok: true,
  },
  {
    name: 'rejects a cross-origin Origin',
    headers: { host: 'localhost:3000', origin: 'http://evil.example' },
    ok: false,
  },
  {
    name: 'rejects when only the Origin port differs from Host',
    headers: { host: 'localhost:3000', origin: 'http://localhost:4000' },
    ok: false,
  },
  {
    name: 'rejects when Origin and Host hostnames differ (localhost vs 127.0.0.1)',
    headers: { host: 'localhost:3000', origin: 'http://127.0.0.1:3000' },
    ok: false,
  },
  {
    name: 'rejects a non-loopback Host even with a matching Origin',
    headers: { host: 'example.com:3000', origin: 'http://example.com:3000' },
    ok: false,
  },
  {
    name: 'rejects a missing Host header',
    headers: { origin: 'http://localhost:3000' },
    ok: false,
  },
  {
    name: 'rejects a "null" Origin (sandboxed frame)',
    headers: { host: 'localhost:3000', origin: 'null' },
    ok: false,
  },
  {
    name: 'rejects a malformed Origin',
    headers: { host: 'localhost:3000', origin: 'not a url' },
    ok: false,
  },
];

describe('isSameOrigin', () => {
  it.each(cases)('$name', ({ headers, ok }) => {
    expect(isSameOrigin(reqWith(headers))).toBe(ok);
  });
});
