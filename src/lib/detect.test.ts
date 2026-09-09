import { beforeEach, expect, test, vi } from 'vitest';
import { getLocation, hasBlockedIp } from './detect';
import { getIpAddress } from './ip';

const IP = '127.0.0.1';

const isLocalhost = vi.mocked(await import('is-localhost-ip'));
const maxmind = vi.mocked(await import('maxmind'));

vi.mock('is-localhost-ip', () => ({
  default: vi.fn(),
}));

vi.mock('maxmind', () => ({
  default: { open: vi.fn() },
}));

beforeEach(() => {
  vi.resetAllMocks();

  delete process.env.CLIENT_IP_HEADER;
  delete process.env.IGNORE_IP;
  delete process.env.SKIP_LOCATION_HEADERS;

  // The reader and its unavailable flag are cached on globalThis across requests
  delete globalThis.maxmind;
  delete globalThis.maxmind_unavailable;
});

test('getIpAddress: Custom header', () => {
  process.env.CLIENT_IP_HEADER = 'x-custom-ip-header';

  expect(getIpAddress(new Headers({ 'x-custom-ip-header': IP }))).toEqual(IP);
});

test('getIpAddress: Custom header set to x-forwarded-for uses leftmost IP in chain', () => {
  process.env.CLIENT_IP_HEADER = 'x-forwarded-for';

  expect(getIpAddress(new Headers({ 'x-forwarded-for': `${IP}, 10.0.0.1, 10.0.0.2` }))).toEqual(IP);
});

test('getIpAddress: CloudFlare header', () => {
  expect(getIpAddress(new Headers({ 'cf-connecting-ip': IP }))).toEqual(IP);
});

test('getIpAddress: Standard header', () => {
  expect(getIpAddress(new Headers({ 'x-forwarded-for': IP }))).toEqual(IP);
});

test('getIpAddress: No header', () => {
  expect(getIpAddress(new Headers())).toEqual(undefined);
});

test('getLocation: returns null for malformed ip', async () => {
  await expect(
    getLocation(
      'not-an-ip',
      new Headers({
        'cf-ipcountry': 'US',
        'cf-region-code': 'CA',
        'cf-ipcity': 'Los Angeles',
      }),
      false,
    ),
  ).resolves.toEqual(null);
});

test('getLocation: treats localhost check errors as non-local', async () => {
  isLocalhost.default.mockRejectedValue(new Error('DNS Lookup failed.'));

  await expect(
    getLocation(
      '8.8.8.8',
      new Headers({
        'cf-ipcountry': 'US',
        'cf-region-code': 'CA',
        'cf-ipcity': 'Los Angeles',
      }),
      false,
    ),
  ).resolves.toEqual({
    country: 'US',
    region: 'US-CA',
    city: 'Los Angeles',
  });
});

test('getLocation: a missing geo database yields no location instead of throwing', async () => {
  isLocalhost.default.mockResolvedValue(false);
  maxmind.default.open.mockRejectedValue(new Error('ENOENT: no such file or directory'));

  // skipHeaders is what a server-side caller triggers by passing payload.ip
  await expect(getLocation('8.8.8.8', new Headers(), true)).resolves.toBeUndefined();
});

test('getLocation: a missing geo database is only looked up once', async () => {
  isLocalhost.default.mockResolvedValue(false);
  maxmind.default.open.mockRejectedValue(new Error('ENOENT: no such file or directory'));

  await getLocation('8.8.8.8', new Headers(), true);
  await getLocation('8.8.4.4', new Headers(), true);

  expect(maxmind.default.open).toHaveBeenCalledTimes(1);
});

test('getLocation: provider headers still win over the database', async () => {
  isLocalhost.default.mockResolvedValue(false);

  await expect(
    getLocation('8.8.8.8', new Headers({ 'x-vercel-ip-country': 'CZ' }), false),
  ).resolves.toEqual({
    country: 'CZ',
    region: undefined,
    city: null,
  });
  expect(maxmind.default.open).not.toHaveBeenCalled();
});

test('hasBlockedIp: returns false for malformed client ip with cidr block', () => {
  process.env.IGNORE_IP = '10.0.0.0/8';

  expect(hasBlockedIp('not-an-ip')).toBe(false);
});
