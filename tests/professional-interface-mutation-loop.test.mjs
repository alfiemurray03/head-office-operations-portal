import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/js/professional-interface.js', import.meta.url), 'utf8');

assert.match(
  source,
  /heading && heading\.textContent !== 'Head Office Operations'/,
  'The governed shell heading must only be rewritten when its value actually changes.'
);
assert.match(
  source,
  /description && description\.textContent !== 'Security and customer operations'/,
  'The governed shell description must only be rewritten when its value actually changes.'
);
assert.doesNotMatch(
  source,
  /MutationObserver\([\s\S]*setShellIdentity[\s\S]*observe\(sidebarHeading/,
  'The professional interface must not observe and rewrite the same sidebar heading, which creates a recursive mutation loop.'
);
assert.doesNotMatch(
  source,
  /observe\(document\.head/,
  'The professional interface must not observe and reorder stylesheets within the same document head.'
);

console.log('Professional interface mutation-loop regression checks passed.');
