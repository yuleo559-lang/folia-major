import { afterEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ enabled: vi.fn(() => false), open: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native.enabled } }));
vi.mock('@capacitor/app-launcher', () => ({ AppLauncher: { openUrl: native.open } }));
import { openOutsideLink, opensThroughDesktopApp } from '../../../src/utils/system/outsideLink';

// test/unit/system/outsideLink.test.ts
// The branching of the one way out of the app that nobody sees by using it: which of the two ways
// an address takes, and what a place that waits for it is told when the desktop app fails.

const ADDRESS = 'https://example.com/page';

const withWindow = (electron?: { openExternalUrl: (url: string) => Promise<boolean> }) => {
    const open = vi.fn();
    vi.stubGlobal('window', { electron, open });
    return open;
};

afterEach(() => {
    vi.unstubAllGlobals();
    native.enabled.mockReturnValue(false);
    native.open.mockReset();
});

describe('openOutsideLink', () => {
    it('hands native links to the OS without opening a WebView popup', async () => {
        const open = withWindow();
        native.enabled.mockReturnValue(true);
        native.open.mockResolvedValue({ completed: true });
        await openOutsideLink(ADDRESS);
        expect(native.open).toHaveBeenCalledExactlyOnceWith({ url: ADDRESS });
        expect(open).not.toHaveBeenCalled();
    });

    it('rejects if the OS cannot open a native link', async () => {
        const open = withWindow();
        native.enabled.mockReturnValue(true);
        native.open.mockResolvedValue({ completed: false });
        await expect(openOutsideLink(ADDRESS)).rejects.toThrow('could not open');
        expect(open).not.toHaveBeenCalled();
    });

    it('propagates native plugin errors instead of pretending a popup succeeded', async () => {
        withWindow();
        native.enabled.mockReturnValue(true);
        native.open.mockRejectedValue(new Error('native unavailable'));
        await expect(openOutsideLink(ADDRESS)).rejects.toThrow('native unavailable');
    });

    it('hands the address to the desktop app where there is one, and opens no tab', async () => {
        const openExternalUrl = vi.fn(async () => true);
        const open = withWindow({ openExternalUrl });
        expect(opensThroughDesktopApp()).toBe(true);
        await openOutsideLink(ADDRESS);
        expect(openExternalUrl).toHaveBeenCalledWith(ADDRESS);
        expect(open).not.toHaveBeenCalled();
    });

    it('opens a new tab that cannot reach the app where there is no desktop app', async () => {
        const open = withWindow();
        expect(opensThroughDesktopApp()).toBe(false);
        await openOutsideLink(ADDRESS);
        expect(open).toHaveBeenCalledWith(ADDRESS, '_blank', 'noopener,noreferrer');
    });

    it('rejects when the desktop app could not take the address, and falls back to no tab', async () => {
        const open = withWindow({ openExternalUrl: () => Promise.reject(new Error('refused')) });
        await expect(openOutsideLink(ADDRESS)).rejects.toThrow('refused');
        expect(open).not.toHaveBeenCalled();
    });
});
