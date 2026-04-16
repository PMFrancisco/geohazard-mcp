import { vi } from 'vitest';

type Body = string | object;

function asResponse(
  body: Body,
  init: ResponseInit = { status: 200 },
): Response {
  if (typeof body === 'string') return new Response(body, init);
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

export function stubFetchOnce(body: Body, init?: ResponseInit) {
  const mock = vi.fn().mockResolvedValue(asResponse(body, init));
  vi.stubGlobal('fetch', mock);
  return mock;
}

export function stubFetchSequence(
  responses: Array<{ body: Body; init?: ResponseInit }>,
) {
  const mock = vi.fn();
  for (const r of responses) {
    mock.mockResolvedValueOnce(asResponse(r.body, r.init));
  }
  vi.stubGlobal('fetch', mock);
  return mock;
}

export function stubFetchError(error: unknown) {
  const mock = vi.fn().mockRejectedValue(error);
  vi.stubGlobal('fetch', mock);
  return mock;
}

export function stubFetchStatus(status: number, body: Body = '') {
  return stubFetchOnce(body, { status, statusText: 'Error' });
}
