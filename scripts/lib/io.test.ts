// SPDX-FileCopyrightText: 2026 Wojciech Polak
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { parseYamlDocument, yamlDocumentText } from './io.ts';

describe('canonical YAML', () => {
  it('reads folded and literal prose as their intended strings', () => {
    const document = parseYamlDocument(
      `summary: >-\n  First sentence.\n  Second sentence.\nnotes: |-\n  First line.\n  Second line.\n`,
      'record.yaml',
    );

    expect(document.toJS()).toEqual({
      summary: 'First sentence. Second sentence.',
      notes: 'First line.\nSecond line.',
    });
  });

  it.each([
    ['duplicate keys', 'id: first\nid: second\n'],
    ['anchors', 'id: &record first\n'],
    ['aliases', 'first: &record value\nsecond: *record\n'],
    ['merge keys', '<<: { id: first }\n'],
    ['explicit tags', 'id: !!str first\n'],
  ])('refuses %s', (_, source) => {
    expect(() => parseYamlDocument(source, 'record.yaml')).toThrow('record.yaml');
  });

  it('keeps comments and emits long prose as an 80-column folded block', () => {
    const document = parseYamlDocument(
      '# Curator note\nsummary: This summary is deliberately long enough to need a readable multiline YAML block for editing.\n',
      'record.yaml',
    );
    document.set('editorialStatus', 'draft');

    const text = yamlDocumentText(document);

    expect(text).toContain('# Curator note');
    expect(text).toContain('summary: >-');
    expect(text).toContain('editorialStatus: draft');
    for (const line of text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });
});
