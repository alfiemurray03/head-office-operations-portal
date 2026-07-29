import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('public/adaptive-tables.css', 'utf8');
const browser = fs.readFileSync('public/js/adaptive-tables.js', 'utf8');
const boot = fs.readFileSync('public/js/boot.js', 'utf8');

assert.match(boot, /loadAdaptiveTablesModule/);
assert.match(boot, /adaptive-tables\.css/);
assert.match(boot, /adaptive-tables\.js/);
assert.match(boot, /Promise\.all\(\[loadAdaptiveTablesModule\(\)/);

assert.match(css, /overflow-x:\s*clip/);
assert.match(css, /min-width:\s*0\s*!important/);
assert.match(css, /table-layout:\s*fixed/);
assert.match(css, /position:\s*sticky/);
assert.match(css, /max-height:\s*clamp/);
assert.match(css, /@media \(max-width: 900px\)/);
assert.match(css, /content:\s*attr\(data-label\)/);
assert.match(css, /\.table-pagination/);

assert.match(browser, /DEFAULT_PAGE_SIZE = 10/);
assert.match(browser, /MutationObserver/);
assert.match(browser, /data-table-page-size/);
assert.match(browser, /row\.hidden/);
assert.match(browser, /adaptive-very-wide/);
assert.match(browser, /window\.enhanceOperationalTables/);

console.log('Adaptive table workspace checks passed.');
