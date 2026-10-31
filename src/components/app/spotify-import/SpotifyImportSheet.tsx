import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List as VirtualList } from 'react-window';
import { ExternalLink, Loader2, LogOut, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../../shared/ConfirmDialog';
import ThemedDialog from '../../shared/ThemedDialog';
import { SheetButton } from '../../shared/Sheet';
import { openSpotifyResource } from '../../../services/onlineMusic/spotify/spotifyExternalPlayback';
import { openLoginWindow } from '../../login/loginWindowStore';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { omni } from '../../../services/onlineMusic/omni';
import { OnlineProviderError, type ProviderCollection } from '../../../types/onlineMusic';
import type { UnifiedSong } from '../../../types';
import { isSpotifyNativeApiEnabled, SPOTIFY_TARGET_PLAYLIST_ID, SPOTIFY_TARGET_PLAYLIST_NAME } from '../../../services/onlineMusic/spotify/spotifyApiConfig';
import { useSpotifyImportUiStore } from './spotifyImportUiStore';

// Spotify content is kept only in component memory for the time this sheet is open.
const PAGE_SIZE = 50;
const TARGET_PLAYLIST: ProviderCollection = {
    providerId: 'spotify',
    id: SPOTIFY_TARGET_PLAYLIST_ID,
    type: 'playlist',
    name: SPOTIFY_TARGET_PLAYLIST_NAME,
    description: '',
};

type RowProps = { tracks: readonly UnifiedSong[]; onOpen: (track: UnifiedSong) => void };

const SpotifyTrackRow = ({ index, style, tracks, onOpen }: any): React.ReactElement => {
    const track = tracks[index] as UnifiedSong;
    return (
        <div style={style} className="px-1 py-1">
            <button
                type="button"
                onClick={() => onOpen(track)}
                aria-label={`${track.name} — ${track.artists.map(artist => artist.name).join(', ')}`}
                className="flex h-full min-h-11 w-full items-center gap-3 rounded-xl border border-[var(--st-line)] bg-[var(--st-fill)] px-3 text-left transition-colors hover:bg-[var(--st-fill2)] active:scale-[0.995]"
            >
                {track.album.coverUrl ? (
                    <img src={track.album.coverUrl} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" loading="lazy" />
                ) : (
                    <span className="h-9 w-9 shrink-0 rounded-md bg-[var(--st-fill2)]" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[color:var(--st-t1)]">{track.name}</span>
                    <span className="block truncate text-xs text-[color:var(--st-t2)]">
                        {track.artists.map(artist => artist.name).join(', ')}{track.album.name ? ` · ${track.album.name}` : ''}
                    </span>
                </span>
                <ExternalLink size={15} className="shrink-0 text-[color:var(--st-t2)]" aria-hidden />
            </button>
        </div>
    );
};

const errorKey = (error: unknown): string => {
    if (error instanceof OnlineProviderError) {
        if (error.code === 'not-public') return 'spotifyImport.errorPlaylistAccess';
        if (error.code === 'auth-required') return 'spotifyImport.errorExpired';
    }
    return 'spotifyImport.errorLoad';
};

const SpotifyImportSheet: React.FC = () => {
    const { t } = useTranslation();
    const isOpen = useSpotifyImportUiStore(state => state.isOpen);
    const close = useSpotifyImportUiStore(state => state.close);
    const account = useOnlineProviderAccountStore(state => state.accounts.spotify);
    const listContainerRef = useRef<HTMLDivElement>(null);
    const requestGeneration = useRef(0);
    const [tracks, setTracks] = useState<UnifiedSong[]>([]);
    const [query, setQuery] = useState('');
    const [listHeight, setListHeight] = useState(300);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [busy, setBusy] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [nextOffset, setNextOffset] = useState(0);
    const [total, setTotal] = useState<number | undefined>();
    const [status, setStatus] = useState<{ key: string; tone: 'error' | 'success' } | null>(null);
    const [confirmSignOut, setConfirmSignOut] = useState(false);

    const connected = account?.status === 'authenticated';
    const checkingAccount = !account || account.status === 'unknown' || (account.status === 'authenticated' && account.freshness === 'refreshing');
    const currentUserId = account?.user?.id === undefined ? '' : String(account.user.id);

    const loadFirstPage = useCallback(async () => {
        if (!connected) return;
        const generation = ++requestGeneration.current;
        setLoading(true);
        setLoadingMore(false);
        setStatus(null);
        setTracks([]);
        setNextOffset(0);
        setHasMore(false);
        try {
            const page = await omni.getCollectionTracks(TARGET_PLAYLIST, { limit: PAGE_SIZE, offset: 0 });
            if (generation !== requestGeneration.current) return;
            setTracks(page.items);
            setNextOffset(page.nextOffset);
            setTotal(page.total);
            setHasMore(page.hasMore);
            if (page.items.length === 0) setStatus({ key: 'spotifyImport.emptyPlaylist', tone: 'success' });
        } catch (error) {
            if (generation === requestGeneration.current) setStatus({ key: errorKey(error), tone: 'error' });
        } finally {
            if (generation === requestGeneration.current) setLoading(false);
        }
    }, [connected]);

    const loadMore = useCallback(async () => {
        if (!connected || !hasMore || loading || loadingMore) return;
        const generation = requestGeneration.current;
        const offset = nextOffset;
        setLoadingMore(true);
        setStatus(null);
        try {
            const page = await omni.getCollectionTracks(TARGET_PLAYLIST, { limit: PAGE_SIZE, offset });
            if (generation !== requestGeneration.current) return;
            setTracks(current => [...current, ...page.items]);
            setNextOffset(page.nextOffset);
            setTotal(page.total);
            setHasMore(page.hasMore);
        } catch (error) {
            if (generation === requestGeneration.current) setStatus({ key: errorKey(error), tone: 'error' });
        } finally {
            if (generation === requestGeneration.current) setLoadingMore(false);
        }
    }, [connected, hasMore, loading, loadingMore, nextOffset]);

    useEffect(() => {
        if (!isOpen) {
            requestGeneration.current += 1;
            setTracks([]);
            setQuery('');
            setTotal(undefined);
            setHasMore(false);
            setNextOffset(0);
            setLoading(false);
            setLoadingMore(false);
            setStatus(null);
            return;
        }
        setQuery('');
        setStatus(null);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !isSpotifyNativeApiEnabled() || connected) return;
        void omni.readAccount('spotify', 'start');
    }, [isOpen, connected]);

    useEffect(() => {
        if (!isOpen || !connected) {
            setTracks([]);
            setTotal(undefined);
            setHasMore(false);
            setNextOffset(0);
            return;
        }
        void loadFirstPage();
    }, [isOpen, connected, currentUserId, loadFirstPage]);

    useEffect(() => {
        if (!isOpen || !listContainerRef.current) return undefined;
        const container = listContainerRef.current;
        const measure = () => setListHeight(Math.max(1, container.clientHeight));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        return () => observer.disconnect();
    }, [isOpen, tracks.length, loading]);

    const visibleTracks = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        if (!needle) return tracks;
        return tracks.filter(track => (
            track.name.toLocaleLowerCase().includes(needle)
            || track.artists.map(artist => artist.name).join(' ').toLocaleLowerCase().includes(needle)
            || track.album.name.toLocaleLowerCase().includes(needle)
        ));
    }, [query, tracks]);

    const openTrack = useCallback((track: UnifiedSong) => {
        void openSpotifyResource('track', String(track.id)).catch(() => setStatus({ key: 'spotifyImport.errorOpenSpotify', tone: 'error' }));
    }, []);
    const rowProps = useMemo<RowProps>(() => ({ tracks: visibleTracks, onOpen: openTrack }), [openTrack, visibleTracks]);
    const countLabel = total === undefined
        ? (connected ? t('spotifyImport.ready') : t('spotifyImport.notConnected'))
        : t('spotifyImport.trackCount', { count: total });

    const openPlaylist = () => {
        void openSpotifyResource('playlist', SPOTIFY_TARGET_PLAYLIST_ID).catch(() => setStatus({ key: 'spotifyImport.errorOpenSpotify', tone: 'error' }));
    };
    const connectSpotify = (event: React.MouseEvent<HTMLButtonElement>) => openLoginWindow('spotify', event.currentTarget);

    return (
        <>
            <ThemedDialog
                isOpen={isOpen}
                onClose={close}
                title={t('spotifyImport.title')}
                description={t('spotifyImport.description')}
                size="l"
                fill
                footerNote={<span aria-live="polite">{countLabel}</span>}
                footer={<SheetButton onClick={close}>{t('ui.close')}</SheetButton>}
            >
                <div className="flex h-full min-h-0 flex-col gap-3">
                    {!isSpotifyNativeApiEnabled() ? (
                        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--st-line)] px-5 py-8 text-center">
                            <p className="max-w-md text-sm leading-6 text-[color:var(--st-t2)]">{t('spotifyImport.iosOnly')}</p>
                        </div>
                    ) : !connected ? (
                        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[var(--st-line)] px-5 py-8 text-center">
                            <div>
                                <p className="text-base font-medium text-[color:var(--st-t1)]">{checkingAccount ? t('spotifyImport.checkingAccount') : t('spotifyImport.connectTitle')}</p>
                                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[color:var(--st-t2)]">
                                    {checkingAccount ? t('spotifyImport.checkingDescription') : account?.status === 'error' ? t('spotifyImport.errorAccount') : t('spotifyImport.connectDescription')}
                                </p>
                            </div>
                            {checkingAccount ? (
                                <span className="inline-flex min-h-11 items-center gap-2 text-sm text-[color:var(--st-t2)]" aria-busy="true">
                                    <Loader2 size={16} className="animate-spin" aria-hidden />{t('spotifyImport.loading')}
                                </span>
                            ) : <button
                                type="button"
                                onClick={connectSpotify}
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--st-accent)] px-4 text-sm font-medium text-[color:var(--st-on-accent)]"
                            >
                                {t('spotifyImport.connect')}
                            </button>}
                            <button type="button" onClick={openPlaylist} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm text-[color:var(--st-t2)]">
                                <ExternalLink size={15} aria-hidden />{t('spotifyImport.openInSpotify')}
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--st-line)] bg-[var(--st-fill)] p-3">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-[color:var(--st-t1)]">{SPOTIFY_TARGET_PLAYLIST_NAME}</p>
                                    <p className="truncate text-xs text-[color:var(--st-t2)]">{t('spotifyImport.connectedAs', { name: account?.user?.nickname || 'Spotify' })}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <button type="button" onClick={() => void loadFirstPage()} disabled={loading} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--st-line)] text-[color:var(--st-t1)] disabled:opacity-50" aria-label={t('spotifyImport.refresh')}>
                                        {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RefreshCw size={16} aria-hidden />}
                                    </button>
                                    <button type="button" onClick={openPlaylist} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--st-line)] px-3 text-sm text-[color:var(--st-t1)]">
                                        <ExternalLink size={15} aria-hidden />{t('spotifyImport.openInSpotify')}
                                    </button>
                                    <button type="button" onClick={() => setConfirmSignOut(true)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--st-line)] text-[color:var(--st-t2)]" aria-label={t('spotifyImport.signOut')} title={t('spotifyImport.signOut')}>
                                        <LogOut size={16} aria-hidden />
                                    </button>
                                </div>
                            </div>

                            {status && (
                                <p role={status.tone === 'error' ? 'alert' : 'status'} className={`shrink-0 text-sm ${status.tone === 'error' ? 'text-[var(--st-err)]' : 'text-[color:var(--st-t2)]'}`}>
                                    {t(status.key)}
                                </p>
                            )}

                            <label className="relative block shrink-0">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--st-t2)]" aria-hidden />
                                <input
                                    type="search"
                                    value={query}
                                    onChange={event => setQuery(event.target.value)}
                                    placeholder={t('spotifyImport.searchPlaceholder')}
                                    aria-label={t('spotifyImport.searchPlaceholder')}
                                    className="min-h-11 w-full rounded-xl border border-[var(--st-line)] bg-[var(--st-fill)] pl-10 pr-3 text-sm text-[color:var(--st-t1)] outline-none placeholder:text-[color:var(--st-t2)] focus:border-[var(--st-accent)]"
                                />
                            </label>

                            <div ref={listContainerRef} className="min-h-[220px] flex-1 overflow-hidden rounded-xl border border-[var(--st-line)]">
                                {loading ? (
                                    <div className="flex h-full min-h-[220px] items-center justify-center gap-2 text-sm text-[color:var(--st-t2)]" aria-busy="true">
                                        <Loader2 size={16} className="animate-spin" aria-hidden />{t('spotifyImport.loading')}
                                    </div>
                                ) : visibleTracks.length === 0 ? (
                                    <div className="flex h-full min-h-[220px] items-center justify-center px-4 text-center text-sm text-[color:var(--st-t2)]">
                                        {query ? t('spotifyImport.noSearchResults') : status?.tone === 'error' ? t(status.key) : t('spotifyImport.emptyPlaylist')}
                                    </div>
                                ) : (
                                    <VirtualList
                                        style={{ height: listHeight, width: '100%' }}
                                        rowCount={visibleTracks.length}
                                        rowHeight={60}
                                        rowProps={rowProps}
                                        rowComponent={SpotifyTrackRow}
                                        className="overflow-x-hidden overscroll-contain"
                                    />
                                )}
                            </div>

                            {hasMore && (
                                <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--st-line)] px-4 text-sm text-[color:var(--st-t1)] disabled:opacity-50">
                                    {loadingMore && <Loader2 size={16} className="animate-spin" aria-hidden />}{t('spotifyImport.loadMore')}
                                </button>
                            )}
                            <p className="shrink-0 text-xs leading-5 text-[color:var(--st-t2)]">{t('spotifyImport.playbackNote')}</p>
                        </>
                    )}
                </div>
            </ThemedDialog>
            <ConfirmDialog
                isOpen={confirmSignOut}
                title={t('spotifyImport.signOutTitle')}
                description={t('spotifyImport.signOutDescription')}
                confirmText={t('spotifyImport.signOut')}
                confirmVariant="danger"
                onConfirm={() => {
                    setConfirmSignOut(false);
                    void omni.signOutAccount('spotify').catch(() => setStatus({ key: 'spotifyImport.errorSignOut', tone: 'error' }));
                }}
                onClose={() => setConfirmSignOut(false)}
            />
        </>
    );
};

export default SpotifyImportSheet;
