import { Capacitor } from '@capacitor/core';

// A public OAuth client ID (not a client secret); Spotify native clients use PKCE.
export const SPOTIFY_CLIENT_ID = '5e6a052043714433930ac9d8da75038d';
export const SPOTIFY_REDIRECT_URI = 'top.izuna.foliamajor.ios://spotify-callback';
export const SPOTIFY_TARGET_PLAYLIST_ID = '3i767yrQJ0zACU50f1FyCa';
export const SPOTIFY_TARGET_PLAYLIST_NAME = '好';
export const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-read-private'] as const;

export const isSpotifyNativeApiEnabled = (): boolean => (
    Capacitor.getPlatform() === 'ios' && SPOTIFY_CLIENT_ID.length > 0
);
