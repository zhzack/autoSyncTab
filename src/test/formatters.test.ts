import { describe, expect, it } from 'vitest';
import {
  exportToJson,
  exportToOneTabText,
  parseJsonBackup,
  parseOneTabText,
} from '../shared/formatters';
import { createDefaultStore, prependGroup } from '../shared/storage';

describe('formatters', () => {
  it('exports and parses OneTab text across multiple groups', () => {
    let store = createDefaultStore(1000);
    store = prependGroup(store, [
      { id: '1', url: 'https://github.com', title: 'GitHub' },
      { id: '2', url: 'https://vitejs.dev', title: 'https://vitejs.dev' },
    ]).nextStore;
    store = prependGroup(store, [{ id: '3', url: 'https://react.dev', title: 'React' }]).nextStore;

    const exported = exportToOneTabText(store.groups);
    expect(exported).toBe(
      'https://react.dev | React\n\nhttps://github.com | GitHub\nhttps://vitejs.dev'
    );

    const parsed = parseOneTabText(
      '# 开发文档\nhttps://react.dev | React\njavascript:alert(1) | XSS\n\nhttps://github.com'
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe('开发文档');
    expect(parsed[0].tabs).toHaveLength(1);
    expect(parsed[0].tabs[0].url).toBe('https://react.dev');
    expect(parsed[1].tabs[0].title).toBe('https://github.com');
  });

  it('exports and restores lossless JSON backups', () => {
    const base = createDefaultStore(500);
    const { nextStore } = prependGroup(
      base,
      [{ id: '1', url: 'https://example.com', title: 'Example' }],
      '我的收藏'
    );

    const json = exportToJson(nextStore);
    const parsed = parseJsonBackup(json);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].title).toBe('我的收藏');

    expect(() => parseJsonBackup('{"bad":true}')).toThrow();
  });
});
