import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/settingsNavigation.spec.ts
// 设置侧栏的分组结构、页眉里的本页目录和 scrollspy 只在真实浏览器里成立：IntersectionObserver、
// 平滑滚动的中间态、以及窄屏时横向类别条的间距都不是单测能覆盖的。
// 探针见 dev/probes/settingsNavigation.probe.tsx。

const content = (page: Page) => page.locator('[data-probe-content]');
const contentsEntry = (page: Page, label: string) => page.locator('header').getByRole('button', { name: label, exact: true });

const scrollTop = (page: Page) => content(page).evaluate(node => node.scrollTop);

/** The entry of the header's contents line that is marked as the group in view. */
const activeContentsLabel = (page: Page): Promise<string | null> => page.evaluate(() => (
    document.querySelector('header button[aria-current="true"]')?.textContent?.trim() ?? null
));

test.describe('settings navigation - wide layout', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('groups the categories under their headings', async ({ mount, page }) => {
        await mount('settingsNavigation');

        for (const heading of ['Interface', 'Music', 'App', 'Advanced']) {
            await expect(page.getByText(heading, { exact: true })).toBeVisible();
        }
    });

    test('lists categories only in the side list and the groups of the page in the header', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await expect(contentsEntry(page, 'Alpha Section')).toBeVisible();
        await expect(contentsEntry(page, 'Echo Section')).toBeVisible();
        await expect(page.locator('aside').getByRole('button', { name: 'Alpha Section' })).toHaveCount(0);
        await expect(page.locator('aside').getByRole('button', { name: 'settingsPagePlayer', exact: true })).toBeVisible();
    });

    test('slots a late-arriving section into its document position', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await expect(contentsEntry(page, 'Bravo Late Section')).toBeVisible();
        await expect(page.locator('[data-settings-anchor="importExportTitle"]')).toBeVisible();

        const labels = await page.locator('header button:not([aria-label])').allTextContents();
        expect(labels).toEqual(['Alpha Section', 'Bravo Section', 'Bravo Late Section', 'Charlie Section', 'Delta Section', 'Echo Section']);
    });

    test('scrolls to a section when its contents entry is clicked', async ({ mount, page }) => {
        await mount('settingsNavigation');

        expect(await scrollTop(page)).toBe(0);
        await contentsEntry(page, 'Delta Section').click();

        await expect.poll(() => scrollTop(page)).toBeGreaterThan(1000);
        // The destination stays marked; a smooth scroll must not light up what it passes through.
        expect(await activeContentsLabel(page)).toBe('Delta Section');
    });

    test('follows the scroll position back to the first section', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await contentsEntry(page, 'Echo Section').click();
        await expect.poll(() => scrollTop(page)).toBeGreaterThan(1000);

        await content(page).evaluate(node => node.scrollTo({ top: 0 }));
        await expect.poll(() => activeContentsLabel(page)).toBe('Alpha Section');
    });

    test('selects the final section once the column bottoms out', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await content(page).evaluate(node => node.scrollTo({ top: node.scrollHeight }));
        await expect.poll(() => activeContentsLabel(page)).toBe('Echo Section');
    });
});

test.describe('settings navigation - touch targets', () => {
    test.use({ viewport: { width: 375, height: 720 }, isMobile: true, hasTouch: true });

    test('categories remain tap-selectable with a minimum 44px target', async ({ mount, page }) => {
        await mount('settingsNavigation');

        const category = page.locator('aside nav button').nth(1);
        const box = await category.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
        await category.tap();
        await expect(category).toHaveAttribute('aria-current', 'page');
    });
});

test.describe('settings navigation - narrow layout', () => {
    test.use({ viewport: { width: 375, height: 720 } });

    test('turns the side list into one flat strip and keeps the contents line', async ({ mount, page }) => {
        await mount('settingsNavigation');

        await expect(page.getByText('Interface', { exact: true })).toBeHidden();
        await expect(page.locator('aside').getByRole('button', { name: 'settingsPagePlayer', exact: true })).toBeVisible();
        await expect(contentsEntry(page, 'Alpha Section')).toBeVisible();
    });

    test('a mouse drag scrolls without selecting a category, and the next click still works', async ({ mount, page }) => {
        await mount('settingsNavigation');
        const nav = page.locator('aside nav');
        const firstCategory = nav.getByRole('button').first();
        const firstBox = await firstCategory.boundingBox();
        if (!firstBox) throw new Error('The first settings category has no visible bounds');
        await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(firstBox.x + firstBox.width / 2 - 120, firstBox.y + firstBox.height / 2, { steps: 6 });
        await page.mouse.up();
        await expect.poll(() => nav.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
        await expect(firstCategory).toHaveAttribute('aria-current', 'page');
        const nextCategory = nav.getByRole('button').nth(1);
        await nextCategory.click();
        await expect(nextCategory).toHaveAttribute('aria-current', 'page');
    });

    test('spaces adjacent categories of the strip exactly 4px apart, across a group boundary too', async ({ mount, page }) => {
        await mount('settingsNavigation');

        // The hidden group names and the group wrappers sit between the buttons in the document; a
        // spacing rule that counted them would widen the gap where one group ends.
        const gaps = await page.evaluate(() => {
            const rects = [...document.querySelectorAll('aside nav button')].map(button => button.getBoundingClientRect());
            return rects.slice(1, 5).map((rect, index) => Math.round(rect.left - rects[index].right));
        });

        expect(gaps).toEqual([4, 4, 4, 4]);
    });
});
