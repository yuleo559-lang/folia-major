import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appHandler: null as null | ((event: { url: string }) => void),
    browserOpen: vi.fn(async (_input: { url: string }) => {}),
    browserClose: vi.fn(async () => {}),
    exchange: vi.fn(async (_code: string, _verifier: string) => {}),
    requestApi: vi.fn(async (_path: string) => ({})),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' } }));
vi.mock('@capacitor/app', () => ({
    App: {
        addListener: vi.fn(async (_name: string, handler: (event: { url: string }) => void) => {
            mocks.appHandler = handler;
            return { remove: vi.fn(async () => {}) };
        }),
    },
}));
vi.mock('@capacitor/browser', () => ({ Browser: { open: mocks.browserOpen, close: mocks.browserClose } }));
vi.mock('@/services/onlineMusic/spotify/spotifyApiTransport', () => ({
    clearSpotifyApiSession: vi.fn(async () => {}),
    exchangeSpotifyAuthorizationCode: mocks.exchange,
    requestSpotifyApi: mocks.requestApi,
}));

import { Browser } from '@capacitor/browser';
import {
    cancelSpotifyApiLogin, checkSpotifyApiLogin, openSpotifyApiLogin, resetSpotifyApiAuthForTests, startSpotifyApiLogin,
} from '@/services/onlineMusic/spotify/spotifyApiAuth';
import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI } from '@/services/onlineMusic/spotify/spotifyApiConfig';

beforeEach(() => {
    mocks.appHandler = null;
    mocks.browserOpen.mockClear();
    mocks.browserClose.mockClear();
    mocks.exchange.mockReset();
    mocks.exchange.mockResolvedValue(undefined);
    mocks.requestApi.mockClear();
});

afterEach(async () => { await resetSpotifyApiAuthForTests(); });

describe('Spotify native PKCE flow', () => {
    it('uses the registered callback and read-only scopes, rejects a mismatched state, and exchanges a valid code once', async () => {
        const key = await startSpotifyApiLogin();
        await openSpotifyApiLogin(key);
        expect(mocks.browserOpen).toHaveBeenCalledTimes(1);
        const authorize = new URL(mocks.browserOpen.mock.calls[0][0].url);
        expect(authorize.origin).toBe('https://accounts.spotify.com');
        expect(authorize.pathname).toBe('/authorize');
        expect(authorize.searchParams.get('client_id')).toBe(SPOTIFY_CLIENT_ID);
        expect(authorize.searchParams.get('redirect_uri')).toBe(SPOTIFY_REDIRECT_URI);
        expect(authorize.searchParams.get('response_type')).toBe('code');
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
        expect(authorize.searchParams.get('scope')?.split(' ')).toEqual([
            'playlist-read-private', 'playlist-read-collaborative', 'user-read-private',
        ]);

        const state = authorize.searchParams.get('state')!;
        mocks.appHandler?.({ url: `${SPOTIFY_REDIRECT_URI}?code=ignored&state=wrong` });
        await expect(checkSpotifyApiLogin(key)).resolves.toEqual({ state: 'waiting' });
        expect(mocks.exchange).not.toHaveBeenCalled();

        mocks.appHandler?.({ url: `${SPOTIFY_REDIRECT_URI}?code=approved-code&state=${encodeURIComponent(state)}` });
        await expect(checkSpotifyApiLogin(key)).resolves.toEqual({ state: 'confirmed' });
        expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith('approved-code', expect.any(String));
        expect(mocks.exchange.mock.calls[0][1].length).toBeGreaterThan(40);
        await expect(checkSpotifyApiLogin(key)).resolves.toEqual({ state: 'confirmed' });
        expect(mocks.exchange).toHaveBeenCalledTimes(1);
    });

    it('removes the listener and closes the system browser when sign-in is cancelled', async () => {
        const key = await startSpotifyApiLogin();
        await openSpotifyApiLogin(key);
        await cancelSpotifyApiLogin(key);
        await expect(checkSpotifyApiLogin(key)).resolves.toEqual({ state: 'expired' });
        expect(mocks.browserClose).toHaveBeenCalled();
        expect(Browser.close).toBe(mocks.browserClose);
    });
});
