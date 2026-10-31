import { create } from 'zustand';

// src/components/app/spotify-import/spotifyImportUiStore.ts
// Ephemeral presentation state for the local Spotify export sheet; imported data itself lives in IndexedDB.

type SpotifyImportUiState = {
    isOpen: boolean;
    open: () => void;
    close: () => void;
};

export const useSpotifyImportUiStore = create<SpotifyImportUiState>(set => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
}));

export const openSpotifyImportSheet = (): void => useSpotifyImportUiStore.getState().open();
