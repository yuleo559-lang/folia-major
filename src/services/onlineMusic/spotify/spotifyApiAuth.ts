import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import type { PluginListenerHandle } from '@capacitor/core';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type { LoginFailureDetail, LoginState, ProviderUser } from '../../../types/onlineMusic';
import { spotifyLoginFailure } from './spotifyLoginFailure';
import {
    isSpotifyNativeApiEnabled, SPOTIFY_AUTHORIZE_URL, SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, SPOTIFY_SCOPES,
} from './spotifyApiConfig';
import { clearSpotifyApiSession, exchangeSpotifyAuthorizationCode, requestSpotifyApi } from './spotifyApiTransport';

const LOGIN_TTL_MS = 10 * 60 * 1000;

type OAuthCallback = { code: string } | { error: string };
type PendingLogin = {
    key: string;
    state: string;
    verifier: string;
    callback: OAuthCallback | null;
    result: LoginState | null;
    exchange: Promise<LoginState> | null;
};
type SpotifyProfile = {
    id?: unknown;
    display_name?: unknown;
    images?: Array<{ url?: unknown; width?: unknown }>;
};

let pending: PendingLogin | null = null;
let callbackListener: PluginListenerHandle | null = null;

const randomUrlSafe = (bytes = 48): string => {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues) throw new OnlineProviderError('unavailable', 'Secure random values are unavailable on this iPhone', 'spotify');
    const random = new Uint8Array(bytes);
    cryptoApi.getRandomValues(random);
    let binary = '';
    random.forEach(value => { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const challengeFor = async (verifier: string): Promise<string> => {
    if (!globalThis.crypto?.subtle) throw new OnlineProviderError('unavailable', 'Secure Spotify sign-in is unavailable on this iPhone', 'spotify');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    let binary = '';
    new Uint8Array(digest).forEach(value => { binary += String.fromCharCode(value); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const removeCallbackListener = async (): Promise<void> => {
    const listener = callbackListener;
    callbackListener = null;
    if (listener) await listener.remove().catch(() => undefined);
};

const closeBrowser = async (): Promise<void> => {
    await Browser.close().catch(() => undefined);
};

const readCallback = (rawUrl: string): void => {
    if (!pending) return;
    let callbackUrl: URL;
    try { callbackUrl = new URL(rawUrl); } catch { return; }
    if (callbackUrl.protocol !== 'top.izuna.foliamajor.ios:' || callbackUrl.host !== 'spotify-callback') return;
    if (callbackUrl.searchParams.get('state') !== pending.state) return;
    const error = callbackUrl.searchParams.get('error');
    const code = callbackUrl.searchParams.get('code');
    if (error) pending.callback = { error };
    else if (code) pending.callback = { code };
    else pending.callback = { error: 'missing_code' };
    void closeBrowser();
};

const errorState = (mainCode: string, failureCase?: LoginFailureDetail['case']): LoginState => {
    const failure = spotifyLoginFailure(mainCode);
    return {
        state: 'error',
        message: mainCode,
        ...((failure || failureCase) ? { failure: { ...(failure ?? { mainCode }), ...(failureCase ? { case: failureCase } : {}) } } : {}),
    };
};

const callbackFailure = (error: string): LoginState => errorState(error === 'access_denied' ? 'access-denied' : 'sign-in-failed');

const exchangeFailure = (error: unknown): LoginState => {
    if (error instanceof OnlineProviderError && error.code === 'network') return errorState('unreachable', 'unreachable');
    if (error instanceof OnlineProviderError && error.httpStatus === 429) return errorState('asked-to-wait', 'retry-later');
    return errorState('sign-in-failed', 'unknown');
};

export const startSpotifyApiLogin = async (): Promise<string> => {
    if (!isSpotifyNativeApiEnabled()) throw new OnlineProviderError('unsupported', 'Spotify account access is available in the iPhone app only', 'spotify');
    if (pending) {
        await Promise.all([removeCallbackListener(), closeBrowser()]);
        pending = null;
    }
    const verifier = randomUrlSafe();
    const state = randomUrlSafe(24);
    const key = randomUrlSafe(18);
    pending = { key, state, verifier, callback: null, result: null, exchange: null };
    try {
        callbackListener = await App.addListener('appUrlOpen', event => readCallback(event.url));
    } catch (error) {
        pending = null;
        throw new OnlineProviderError('unavailable', 'Could not register Spotify sign-in callback on this iPhone', 'spotify', error);
    }
    return key;
};

export const openSpotifyApiLogin = async (key: string): Promise<void> => {
    if (!pending || pending.key !== key) throw new OnlineProviderError('unavailable', 'Spotify sign-in has expired', 'spotify');
    const challenge = await challengeFor(pending.verifier);
    const url = new URL(SPOTIFY_AUTHORIZE_URL);
    url.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI);
    url.searchParams.set('scope', SPOTIFY_SCOPES.join(' '));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('state', pending.state);
    try {
        await Browser.open({ url: url.toString() });
    } catch (error) {
        throw new OnlineProviderError('unavailable', 'Could not open Spotify sign-in in the system browser', 'spotify', error);
    }
};

export const checkSpotifyApiLogin = async (key: string): Promise<LoginState> => {
    const current = pending;
    if (!current || current.key !== key) return { state: 'expired' };
    if (current.result) return current.result;
    if (!current.callback) return { state: 'waiting' };
    if ('error' in current.callback) {
        current.result = callbackFailure(current.callback.error);
        await removeCallbackListener();
        return current.result;
    }
    if (!current.exchange) {
        const { code } = current.callback;
        const verifier = current.verifier;
        current.exchange = exchangeSpotifyAuthorizationCode(code, verifier)
            .then((): LoginState => ({ state: 'confirmed' }))
            .catch(exchangeFailure)
            .finally(() => { void removeCallbackListener(); });
    }
    const result = await current.exchange;
    current.result = result;
    current.callback = null;
    current.verifier = '';
    return result;
};

export const cancelSpotifyApiLogin = async (key: string): Promise<void> => {
    if (!pending || pending.key !== key) return;
    pending = null;
    await Promise.all([removeCallbackListener(), closeBrowser()]);
};

export const getSpotifyApiLoginTtlMs = (): number => LOGIN_TTL_MS;

export const getSpotifyApiLoginStatus = async (): Promise<ProviderUser | null> => {
    try {
        const profile = await requestSpotifyApi<SpotifyProfile>('/me');
        const id = typeof profile.id === 'string' ? profile.id : '';
        if (!id) throw new OnlineProviderError('invalid-response', 'Spotify profile has no user id', 'spotify');
        const images = (profile.images ?? []).filter(image => typeof image.url === 'string')
            .sort((left, right) => Number(right.width) - Number(left.width));
        return {
            id,
            nickname: typeof profile.display_name === 'string' && profile.display_name ? profile.display_name : id,
            ...(typeof images[0]?.url === 'string' ? { avatarUrl: images[0].url } : {}),
        };
    } catch (error) {
        if (error instanceof OnlineProviderError && error.code === 'auth-required') return null;
        throw error;
    }
};

export const logoutSpotifyApi = async (): Promise<void> => {
    await clearSpotifyApiSession();
};

export const resetSpotifyApiAuthForTests = async (): Promise<void> => {
    pending = null;
    await Promise.all([removeCallbackListener(), closeBrowser()]);
};
