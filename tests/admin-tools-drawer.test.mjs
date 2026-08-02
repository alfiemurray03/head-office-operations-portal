import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, styles, boot] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/professional-interface.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/boot.js', import.meta.url), 'utf8')
]);

assert.match(index, /id="menuButton"[^>]+aria-controls="sidebar"/, 'The All admin tools button must control the drawer.');
assert.match(boot, /menuButton[\s\S]*classList\.toggle\('open'\)/, 'The button must toggle the drawer open state.');
assert.match(styles, /#sidebar\.tools-drawer\s*\{[\s\S]*visibility:\s*hidden !important/, 'The desktop drawer must have a closed state.');
assert.match(styles, /#sidebar\.tools-drawer\.open\s*\{[\s\S]*visibility:\s*visible !important[\s\S]*pointer-events:\s*auto !important/, 'The desktop drawer must have an interactive open state.');
assert.match(styles, /#menuButton\.all-tools-button[\s\S]*display:\s*inline-flex !important/, 'The desktop trigger must remain visible.');

console.log('All admin tools drawer regression checks passed.');
