import test from 'node:test';
import assert from 'node:assert/strict';
import { adminIcons, navIcons, settingsIcons } from '../components/analytics/nav-icons.ts';

test('one icon per feature: no two navigation destinations share an icon', () => {
  const seen = new Map<unknown, string>();
  for (const [destination, icon] of [
    ...Object.entries(navIcons),
    ...Object.entries(settingsIcons).map(([id, icon]) => [`settings:${id}`, icon] as const),
    ...Object.entries(adminIcons).map(([id, icon]) => [`admin:${id}`, icon] as const),
  ]) {
    assert.equal(seen.get(icon), undefined, `${destination} reuses the icon of ${seen.get(icon)}`);
    seen.set(icon, destination);
  }
});
