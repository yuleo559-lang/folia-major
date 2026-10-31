import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/onlineMusic/spotify/spotifyApiTransport', () => ({ requestSpotifyApi: vi.fn() }));

import { requestSpotifyApi } from '@/services/onlineMusic/spotify/spotifyApiTransport';
import {
    getSpotifyApiPlaylists, getSpotifyApiPlaylistTracks,
} from '@/services/onlineMusic/spotify/spotifyApiLibrary';
import { SPOTIFY_TARGET_PLAYLIST_ID } from '@/services/onlineMusic/spotify/spotifyApiConfig';

const request = vi.mocked(requestSpotifyApi);
const trackId = '1234567890123456789012';
const albumId = '2234567890123456789012';
const artistId = '3234567890123456789012';

describe('Spotify iPhone playlist adapter', () => {
    beforeEach(() => request.mockReset());

    it('exposes only the playlist selected by the user, without enumerating the rest of their Spotify library', async () => {
        const page = await getSpotifyApiPlaylists('user-1', 50, 0);
        expect(page).toMatchObject({
            items: [{ providerId: 'spotify', id: SPOTIFY_TARGET_PLAYLIST_ID, name: '好', type: 'playlist' }],
            total: 1,
            nextOffset: 1,
            hasMore: false,
        });
        expect(request).not.toHaveBeenCalled();
    });

    it('reads 2026 API `item` rows, caps each request at 50, and skips episodes and local files', async () => {
        request.mockResolvedValue({
            items: [
                { item: {
                    id: trackId,
                    uri: `spotify:track:${trackId}`,
                    type: 'track',
                    name: 'A song',
                    duration_ms: 186000,
                    artists: [{ id: artistId, name: 'An artist', uri: `spotify:artist:${artistId}` }],
                    album: {
                        id: albumId,
                        uri: `spotify:album:${albumId}`,
                        name: 'An album',
                        images: [{ url: 'https://i.scdn.co/image/cover', width: 640 }],
                    },
                } },
                { item: { id: 'episode-id', uri: 'spotify:episode:episode-id', type: 'episode', name: 'Podcast' } },
                { item: { id: 'local-id', type: 'track', is_local: true, name: 'Local file' } },
            ],
            total: 61,
            next: 'https://api.spotify.com/v1/playlists/next-page',
        } as never);

        const page = await getSpotifyApiPlaylistTracks(SPOTIFY_TARGET_PLAYLIST_ID, 100, 0);
        expect(request).toHaveBeenCalledExactlyOnceWith(`/playlists/${SPOTIFY_TARGET_PLAYLIST_ID}/items?limit=50&offset=0`);
        expect(page).toMatchObject({ total: 61, nextOffset: 3, hasMore: true });
        expect(page.items).toHaveLength(1);
        expect(page.items[0]).toMatchObject({
            id: trackId,
            name: 'A song',
            durationMs: 186000,
            artists: [{ id: artistId, name: 'An artist' }],
            album: { id: albumId, name: 'An album', coverUrl: 'https://i.scdn.co/image/cover' },
            sourceRef: { kind: 'online', providerId: 'spotify', mediaId: trackId },
            collectionRowId: `${SPOTIFY_TARGET_PLAYLIST_ID}:0:${trackId}`,
        });
    });

    it('uses Spotify row offsets on later pages and handles an empty last page', async () => {
        request.mockResolvedValue({ items: [], total: 50, next: null } as never);
        const page = await getSpotifyApiPlaylistTracks(SPOTIFY_TARGET_PLAYLIST_ID, 50, 50);
        expect(request).toHaveBeenCalledExactlyOnceWith(`/playlists/${SPOTIFY_TARGET_PLAYLIST_ID}/items?limit=50&offset=50`);
        expect(page).toMatchObject({ items: [], total: 50, nextOffset: 50, hasMore: false });
    });
});
