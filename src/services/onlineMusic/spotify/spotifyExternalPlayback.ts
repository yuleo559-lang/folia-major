import { Capacitor } from '@capacitor/core';
import { openOutsideLink } from '../../../utils/system/outsideLink';

/** Spotify metadata is not an audio source. Hand it to Spotify, never to Folia's audio queue. */
export const openSpotifyResource = async (kind: 'track' | 'playlist', id: string): Promise<void> => {
    if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new Error('Invalid Spotify resource id');
    if (Capacitor.getPlatform() === 'ios') {
        try {
            await openOutsideLink(`spotify:${kind}:${id}`);
            return;
        } catch {
            // Spotify may not be installed. Ask the OS for the HTTPS link instead.
        }
    }
    await openOutsideLink(`https://open.spotify.com/${kind}/${id}`);
};
