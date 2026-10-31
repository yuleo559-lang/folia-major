import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { OnlineProviderError } from '../../../types/onlineMusic';
import {
    isSpotifyNativeApiEnabled, SPOTIFY_API_BASE, SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, SPOTIFY_TOKEN_URL,
} from './spotifyApiConfig';

const REFRESH_TOKEN_KEY = 'refresh_token';
const STORAGE_PREFIX = 'folia-spotify-';
const ACCESS_TOKEN_SKEW_MS = 60_000;

type SpotifyTokenResponse = {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    error?: unknown;
};

let storageReady: Promise<void> | null = null;
let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
let refreshInFlight: Promise<string | null> | null = null;

const ensureSecureStorage = (): Promise<void> => {
    if (!isSpotifyNativeApiEnabled()) {
        return Promise.reject(new OnlineProviderError('unsupported', 'Spotify account access is available in the iPhone app only', 'spotify'));
    }
    if (!storageReady) {
        storageReady = (async () => {
            await SecureStorage.setKeyPrefix(STORAGE_PREFIX);
            await SecureStorage.setSynchronize(false);
            await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
        })().catch(error => {
            storageReady = null;
            throw new OnlineProviderError('unavailable', 'Spotify secure storage is unavailable', 'spotify', error);
        });
    }
    return storageReady;
};

const tokenRequest = async (body: URLSearchParams): Promise<SpotifyTokenResponse> => {
    let response: Response;
    try {
        response = await fetch(SPOTIFY_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            cache: 'no-store',
            credentials: 'omit',
        });
    } catch (error) {
        throw new OnlineProviderError('network', 'Could not reach Spotify authentication', 'spotify', error);
    }

    const payload = await response.json().catch(() => null) as SpotifyTokenResponse | null;
    if (!response.ok) {
        if ((response.status === 400 || response.status === 401) && payload?.error === 'invalid_grant') {
            await clearSpotifyApiSession();
            throw new OnlineProviderError('auth-required', 'Spotify sign-in has expired', 'spotify', undefined, response.status);
        }
        const retryAfter = Number(response.headers.get('Retry-After'));
        throw new OnlineProviderError(
            response.status === 429 ? 'network' : 'unavailable',
            'Spotify authentication request failed',
            'spotify',
            undefined,
            response.status,
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        );
    }
    if (!payload || typeof payload.access_token !== 'string' || !payload.access_token || !Number.isFinite(Number(payload.expires_in))) {
        throw new OnlineProviderError('invalid-response', 'Spotify returned an invalid token response', 'spotify');
    }
    return payload;
};

const holdAccessToken = (payload: SpotifyTokenResponse): string => {
    accessToken = payload.access_token as string;
    accessTokenExpiresAt = Date.now() + Math.max(0, Number(payload.expires_in)) * 1000;
    return accessToken;
};

const readRefreshToken = async (): Promise<string | null> => {
    await ensureSecureStorage();
    const token = await SecureStorage.get(REFRESH_TOKEN_KEY, false, false);
    return typeof token === 'string' && token.length > 0 ? token : null;
};

const storeRefreshToken = async (token: string): Promise<void> => {
    await ensureSecureStorage();
    await SecureStorage.set(REFRESH_TOKEN_KEY, token, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
};

export const clearSpotifyApiSession = async (): Promise<void> => {
    accessToken = null;
    accessTokenExpiresAt = 0;
    refreshInFlight = null;
    if (!isSpotifyNativeApiEnabled()) return;
    try {
        await ensureSecureStorage();
        await SecureStorage.remove(REFRESH_TOKEN_KEY, false);
    } catch (error) {
        // Do not hide an explicit sign-out failure: the caller can surface it, and the token is never logged.
        throw new OnlineProviderError('unavailable', 'Could not clear Spotify sign-in from this iPhone', 'spotify', error);
    }
};

const saveTokenResponse = async (payload: SpotifyTokenResponse): Promise<string> => {
    if (typeof payload.refresh_token === 'string' && payload.refresh_token) {
        await storeRefreshToken(payload.refresh_token);
    }
    return holdAccessToken(payload);
};

const refreshAccessToken = async (): Promise<string | null> => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
        const refreshToken = await readRefreshToken();
        if (!refreshToken) return null;
        const payload = await tokenRequest(new URLSearchParams({
            client_id: SPOTIFY_CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        }));
        return saveTokenResponse(payload);
    })().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
};

export const exchangeSpotifyAuthorizationCode = async (code: string, verifier: string): Promise<void> => {
    const payload = await tokenRequest(new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        code_verifier: verifier,
    }));
    if (typeof payload.refresh_token !== 'string' || !payload.refresh_token) {
        throw new OnlineProviderError('invalid-response', 'Spotify did not return a refresh token', 'spotify');
    }
    await saveTokenResponse(payload);
};

const currentAccessToken = async (forceRefresh = false): Promise<string | null> => {
    if (!forceRefresh && accessToken && Date.now() + ACCESS_TOKEN_SKEW_MS < accessTokenExpiresAt) return accessToken;
    return refreshAccessToken();
};

const responseError = (response: Response): OnlineProviderError => {
    const retryAfter = Number(response.headers.get('Retry-After'));
    if (response.status === 401) return new OnlineProviderError('auth-required', 'Spotify sign-in has expired', 'spotify', undefined, 401);
    if (response.status === 403) return new OnlineProviderError('not-public', 'Spotify denied access to this private playlist', 'spotify', undefined, 403);
    return new OnlineProviderError(
        response.status === 429 ? 'network' : 'unavailable',
        'Spotify API request failed',
        'spotify',
        undefined,
        response.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    );
};

export const requestSpotifyApi = async <T>(path: string): Promise<T> => {
    const request = async (token: string): Promise<Response> => {
        try {
            return await fetch(`${SPOTIFY_API_BASE}${path}`, {
                headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
                cache: 'no-store',
                credentials: 'omit',
            });
        } catch (error) {
            throw new OnlineProviderError('network', 'Could not reach Spotify', 'spotify', error);
        }
    };

    let token = await currentAccessToken();
    if (!token) throw new OnlineProviderError('auth-required', 'Connect your Spotify account first', 'spotify');
    let response = await request(token);
    if (response.status === 401) {
        token = await currentAccessToken(true);
        if (!token) throw new OnlineProviderError('auth-required', 'Spotify sign-in has expired', 'spotify', undefined, 401);
        response = await request(token);
        if (response.status === 401) {
            await clearSpotifyApiSession();
            throw new OnlineProviderError('auth-required', 'Spotify sign-in has expired', 'spotify', undefined, 401);
        }
    }
    if (!response.ok) throw responseError(response);
    try {
        return await response.json() as T;
    } catch (error) {
        throw new OnlineProviderError('invalid-response', 'Spotify returned invalid playlist data', 'spotify', error);
    }
};

export const resetSpotifyApiTransportForTests = (): void => {
    storageReady = null;
    accessToken = null;
    accessTokenExpiresAt = 0;
    refreshInFlight = null;
};
