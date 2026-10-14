import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../web/style.css',import.meta.url),'utf8');
const source=readFileSync(new URL('../web/main.js',import.meta.url),'utf8');

test('Telegram Mini App has full width root and intrinsically shrinking layout containers',()=>{
 assert.match(css,/html,body\s*\{[^}]*max-width:100%[^}]*overflow-x:clip/);
 assert.match(css,/main,#root,\.dashboard,[^}]*min-width:0;max-width:100%/);
});

test('all dashboard tabs have wrapped grid layout without sideways scrolling',()=>{
 assert.match(source,/\['overview','Обзор'\]/);
 assert.match(source,/\['schedule','График'\]/);
 assert.match(source,/\['analytics','(?:Табель|Аналитика)'\]/);
 assert.match(source,/\['reports','Отчёты'\]/);
 assert.match(source,/\['settings','Настройки'\]/);
 assert.match(css,/\.dashboard-nav\{\s*display:grid;grid-template-columns:repeat\(auto-fit,minmax\(90px,1fr\)\);\s*width:100%;overflow:visible/);
 assert.match(css,/@media\(max-width:650px\)\{[\s\S]*?\.dashboard-nav\{\s*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/\.dashboard-nav \.tab\{\s*min-width:0;width:100%;white-space:normal/);
});

test('all primary owner actions fit two equal columns on mobile',()=>{
 assert.match(source,/className:'header-actions'\},scanButton\(\),controlUI\.button\(\),period,ui\('button'/);
 assert.match(css,/@media\(max-width:650px\)\{[\s\S]*?\.dashboard-header \.header-actions\{\s*display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/\.header-actions>button,\.header-actions>input\{[\s\S]*?white-space:normal/);
});

test('tables display labelled vertical cards, not 520px scrolling tables, on phones',()=>{
 assert.match(source,/ui\('td',\{'data-label':String\(headers\[i\]\?\?''\)\}/);
 assert.match(css,/@media\(max-width:650px\)\{[\s\S]*?\.table-scroll\{width:100%;overflow:visible\}/);
 assert.match(css,/\.table-scroll tbody td\{\s*display:grid;grid-template-columns:minmax\(0,2fr\) minmax\(0,3fr\)/);
 assert.match(css,/content:attr\(data-label\)/);
});

test('stat cards remain a two-column grid on phones',()=>{
 assert.match(css,/@media\(max-width:650px\)\{[\s\S]*?\.stats-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/\.stat\{min-width:0;padding:13px;/);
});
