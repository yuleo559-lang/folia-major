import type { UnifiedSong } from '../../../types';
import type { ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { SPOTIFY_TARGET_PLAYLIST_ID, SPOTIFY_TARGET_PLAYLIST_NAME } from './spotifyApiConfig';
import { requestSpotifyApi } from './spotifyApiTransport';
import { spotifySongOf } from './spotifyNormalize';

type ApiImage = { url?: unknown; width?: unknown };
type ApiArtist = { id?: unknown; name?: unknown; uri?: unknown };
type ApiAlbum = { id?: unknown; name?: unknown; uri?: unknown; images?: ApiImage[] };
type ApiTrack = {
    id?: unknown;
    uri?: unknown;
    name?: unknown;
    type?: unknown;
    is_local?: unknown;
    duration_ms?: unknown;
    artists?: ApiArtist[];
    album?: ApiAlbum;
};
type PlaylistItem = { item?: ApiTrack | null; track?: ApiTrack | null };
type PlaylistItemsPage = { items?: PlaylistItem[]; total?: unknown; next?: unknown };

const apiLimit = (limit: number, max: number): number => Math.max(1, Math.min(max, Math.floor(limit) || 50));
const imagesOf = (images: ApiImage[] | undefined): Array<{ url?: string; width?: number | null }> => (
    (images ?? []).filter(image => typeof image.url === 'string').map(image => ({
        url: image.url as string,
        width: Number.isFinite(Number(image.width)) ? Number(image.width) : null,
    }))
);
const totalOf = (value: unknown): number | undefined => (
    Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined
);

// The account surface exposes only the one playlist the listener chose, not the rest of their library.
export const getSpotifyApiPlaylists = async (_userId: string | number, _limit: number, offset: number): Promise<ProviderPage<ProviderCollection>> => {
    if (Math.max(0, Math.floor(offset) || 0) > 0) return { items: [], total: 1, nextOffset: Math.max(0, Math.floor(offset) || 0), hasMore: false };
    return {
        items: [{
            providerId: 'spotify',
            id: SPOTIFY_TARGET_PLAYLIST_ID,
            type: 'playlist',
            name: SPOTIFY_TARGET_PLAYLIST_NAME,
            description: '',
        }],
        total: 1,
        nextOffset: 1,
        hasMore: false,
    };
};

export const getSpotifyApiPlaylistTracks = async (
    playlistId: string | number,
    limit: number,
    offset: number,
): Promise<ProviderPage<UnifiedSong>> => {
    const id = String(playlistId);
    if (!/^[0-9A-Za-z]{22}$/.test(id)) throw new OnlineProviderError('invalid-response', 'Spotify playlist id is invalid', 'spotify');
    const start = Math.max(0, Math.floor(offset) || 0);
    const page = await requestSpotifyApi<PlaylistItemsPage>(`/playlists/${encodeURIComponent(id)}/items?limit=${apiLimit(limit, 50)}&offset=${start}`);
    if (!page || !Array.isArray(page.items)) throw new OnlineProviderError('invalid-response', 'Spotify returned invalid playlist tracks', 'spotify');
    const songs = page.items.flatMap((row, index): UnifiedSong[] => {
        const track = row?.item ?? row?.track;
        const trackId = typeof track?.id === 'string' ? track.id : '';
        if (!track || !trackId || track.is_local === true || (track.type && track.type !== 'track')) return [];
        const uri = typeof track.uri === 'string' ? track.uri : `spotify:track:${trackId}`;
        const album = track.album;
        const albumId = typeof album?.id === 'string' ? album.id : '';
        const albumUri = typeof album?.uri === 'string' ? album.uri : (albumId ? `spotify:album:${albumId}` : undefined);
        const artists = (track.artists ?? []).map(artist => ({
            uri: typeof artist?.uri === 'string' ? artist.uri : (typeof artist?.id === 'string' ? `spotify:artist:${artist.id}` : undefined),
            profile: { name: typeof artist?.name === 'string' ? artist.name : '' },
        }));
        const song = spotifySongOf({
            __typename: 'Track',
            uri,
            name: typeof track.name === 'string' ? track.name : '',
            artists: { items: artists },
            albumOfTrack: album ? {
                ...(albumUri ? { uri: albumUri } : {}),
                name: typeof album.name === 'string' ? album.name : '',
                coverArt: { sources: imagesOf(album.images) },
            } : undefined,
            duration: { totalMilliseconds: Number(track.duration_ms) || 0 },
        });
        if (!song) return [];
        song.collectionRowId = `${id}:${start + index}:${trackId}`;
        return [song];
    });
    const total = totalOf(page.total);
    const nextOffset = start + page.items.length;
    return { items: songs, ...(total === undefined ? {} : { total }), nextOffset, hasMore: Boolean(page.next) && page.items.length > 0 };
};
