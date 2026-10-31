import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ platform: vi.fn(() => 'ios'), open: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: mocks.platform } }));
vi.mock('@/utils/system/outsideLink', () => ({ openOutsideLink: mocks.open }));
import { openSpotifyResource } from '@/services/onlineMusic/spotify/spotifyExternalPlayback';
const id = '3i767yrQJ0zACU50f1FyCa';
beforeEach(() => { mocks.platform.mockReturnValue('ios'); mocks.open.mockReset().mockResolvedValue(undefined); });
describe('Spotify external playback', () => {
    it('opens the iOS app without asking Folia for audio', async () => {
        await openSpotifyResource('track', id);
        expect(mocks.open).toHaveBeenCalledExactlyOnceWith(`spotify:track:${id}`);
    });
    it('falls back to HTTPS when the app is not installed', async () => {
        mocks.open.mockRejectedValueOnce(new Error('not installed'));
        await openSpotifyResource('playlist', id);
        expect(mocks.open.mock.calls).toEqual([[`spotify:playlist:${id}`], [`https://open.spotify.com/playlist/${id}`]]);
    });
    it('reports failure when neither app nor web can open', async () => {
        mocks.open.mockRejectedValue(new Error('blocked'));
        await expect(openSpotifyResource('track', id)).rejects.toThrow('blocked');
    });
    it('keeps ordinary web and desktop links as HTTPS', async () => {
        mocks.platform.mockReturnValue('web');
        await openSpotifyResource('track', id);
        expect(mocks.open).toHaveBeenCalledExactlyOnceWith(`https://open.spotify.com/track/${id}`);
    });
    it('rejects invalid ids before opening anything', async () => {
        await expect(openSpotifyResource('track', '../invalid')).rejects.toThrow('Invalid');
        expect(mocks.open).not.toHaveBeenCalled();
    });
});
