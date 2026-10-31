import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios', isNativePlatform: () => true } }));
vi.mock('@/utils/system/outsideLink', () => ({ openOutsideLink: vi.fn(async () => undefined) }));
import { openOutsideLink } from '@/utils/system/outsideLink';
import { omni } from '@/services/onlineMusic/omni';
import { spotifyProvider } from '@/services/onlineMusic/spotify/spotifyProvider';
import { isQueueSongPlayable, isRestoredSongPlayable } from '@/components/app/playback/playableSong';
import type { SongResult } from '@/types';
const id = '3i767yrQJ0zACU50f1FyCa';
const song: SongResult = { id, name: 'Test', artists: [], album: { id: '', name: '' }, durationMs: 1000, sourceRef: { kind: 'online', providerId: 'spotify', mediaId: id } };
beforeEach(() => vi.mocked(openOutsideLink).mockClear());
afterEach(() => vi.restoreAllMocks());
describe('iPhone Spotify is metadata-only', () => {
    it('never marks tracks playable in the Folia queue or restored session', () => {
        expect(spotifyProvider.capabilities.playback).toBe(false);
        expect(omni.canPlaySong(song)).toBe(false);
        expect(isQueueSongPlayable(song)).toBe(false);
        expect(isRestoredSongPlayable(song)).toBe(false);
    });
    it('provides an explicit handoff without fetching audio', async () => {
        const audio = vi.spyOn(spotifyProvider.playback!, 'getAudioSource');
        const handoff = omni.getExternalPlayback(song);
        expect(handoff).not.toBeNull();
        await handoff!();
        expect(openOutsideLink).toHaveBeenCalledExactlyOnceWith(`spotify:track:${id}`);
        expect(audio).not.toHaveBeenCalled();
    });
    it('refuses desktop audio even if a stale caller bypasses the capability check', async () => {
        await expect(spotifyProvider.playback!.getAudioSource(song, 'high')).resolves.toBeNull();
    });
    it('does not hijack ordinary in-app providers', () => {
        expect(omni.getExternalPlayback({ ...song, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' } })).toBeNull();
    });
});
