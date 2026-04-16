// Тесты property-based для иконок
// Запуск: node tests/icons.test.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fc from 'fast-check';
import { DOMParser } from '@xmldom/xmldom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Вспомогательные функции ───────────────────────────────────────────────

function loadSprite() {
  const spritePath = path.join(__dirname, '../icons/icons-sprite.svg');
  const svgText = fs.readFileSync(spritePath, 'utf-8');
  const parser = new DOMParser();
  return parser.parseFromString(svgText, 'image/svg+xml');
}

function getSymbols(doc) {
  const symbols = doc.getElementsByTagName('symbol');
  return Array.from({ length: symbols.length }, (_, i) => symbols[i]);
}

function getAllChildren(el) {
  const result = [];
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType === 1) {
      result.push(child);
      result.push(...getAllChildren(child));
    }
  }
  return result;
}

// ─── Счётчик результатов ───────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

// ─── Загрузка спрайта ─────────────────────────────────────────────────────

console.log('\n=== Загрузка спрайта ===');
let doc, symbols;
try {
  doc = loadSprite();
  symbols = getSymbols(doc);
  console.log(`  Загружено ${symbols.length} иконок\n`);
} catch (e) {
  console.error('  ОШИБКА: не удалось загрузить спрайт:', e.message);
  process.exit(1);
}

// ─── Property 1: Уникальность id ──────────────────────────────────────────

console.log('=== Property 1: Уникальность id в спрайте ===');
// Feature: emoji-to-svg-icons, Property 1: все id в спрайте уникальны

assert('все id символов уникальны', () => {
  const ids = symbols.map(s => s.getAttribute('id')).filter(Boolean);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    throw new Error(`Найдены дублирующиеся id: ${dupes.join(', ')}`);
  }
});

assert('property-based: любые два разных symbol имеют разные id', () => {
  const ids = symbols.map(s => s.getAttribute('id')).filter(Boolean);
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: ids.length - 1 }),
      fc.integer({ min: 0, max: ids.length - 1 }),
      (i, j) => i === j || ids[i] !== ids[j]
    ),
    { numRuns: 200 }
  );
});

assert('все id начинаются с "icon-"', () => {
  const bad = symbols
    .map(s => s.getAttribute('id'))
    .filter(id => id && !id.startsWith('icon-'));
  if (bad.length > 0) throw new Error(`id без префикса "icon-": ${bad.join(', ')}`);
});

// ─── Property 2: viewBox === "0 0 24 24" ──────────────────────────────────

console.log('\n=== Property 2: viewBox "0 0 24 24" для всех symbol ===');
// Feature: emoji-to-svg-icons, Property 2: viewBox === "0 0 24 24" для каждого symbol

assert('все symbol имеют viewBox="0 0 24 24"', () => {
  const bad = symbols.filter(s => s.getAttribute('viewBox') !== '0 0 24 24');
  if (bad.length > 0) {
    const ids = bad.map(s => s.getAttribute('id') || '(без id)');
    throw new Error(`Неверный viewBox у: ${ids.join(', ')}`);
  }
});

assert('property-based: viewBox каждого symbol соответствует стандарту', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: symbols.length - 1 }),
      (i) => symbols[i].getAttribute('viewBox') === '0 0 24 24'
    ),
    { numRuns: 100 }
  );
});

// ─── Property 3: currentColor ─────────────────────────────────────────────

console.log('\n=== Property 3: stroke/fill === "currentColor" или "none" ===');
// Feature: emoji-to-svg-icons, Property 3: все иконки используют currentColor

const FIXED_COLOR_ICONS = new Set([
  'icon-england',
  'icon-yellow-card',
  'icon-red-card',
  'icon-google',
]);

const VALID_COLOR_VALUES = new Set(['currentcolor', 'none', 'inherit', '']);

function isValidColorValue(val) {
  if (!val) return true;
  return VALID_COLOR_VALUES.has(val.toLowerCase().trim());
}

assert('все иконки (кроме fixed-color) используют currentColor или none', () => {
  const violations = [];
  for (const symbol of symbols) {
    const id = symbol.getAttribute('id') || '';
    if (FIXED_COLOR_ICONS.has(id)) continue;
    for (const el of [symbol, ...getAllChildren(symbol)]) {
      if (el.nodeType !== 1) continue;
      const stroke = el.getAttribute('stroke');
      const fill = el.getAttribute('fill');
      if (stroke && !isValidColorValue(stroke)) violations.push(`${id}: stroke="${stroke}"`);
      if (fill && !isValidColorValue(fill)) violations.push(`${id}: fill="${fill}"`);
    }
  }
  if (violations.length > 0) {
    throw new Error(`Жёстко заданные цвета:\n    ${violations.join('\n    ')}`);
  }
});

assert('property-based: случайный non-fixed symbol использует currentColor', () => {
  const nonFixed = symbols.filter(s => !FIXED_COLOR_ICONS.has(s.getAttribute('id') || ''));
  if (nonFixed.length === 0) return;
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: nonFixed.length - 1 }),
      (i) => {
        for (const el of [nonFixed[i], ...getAllChildren(nonFixed[i])]) {
          if (el.nodeType !== 1) continue;
          const stroke = el.getAttribute('stroke');
          const fill = el.getAttribute('fill');
          if (stroke && !isValidColorValue(stroke)) return false;
          if (fill && !isValidColorValue(fill)) return false;
        }
        return true;
      }
    ),
    { numRuns: 100 }
  );
});

// ─── Property 4: stroke-width в диапазоне 1.5–2 ──────────────────────────

console.log('\n=== Property 4: stroke-width ∈ [1.5, 2] ===');
// Feature: emoji-to-svg-icons, Property 4: stroke-width в допустимом диапазоне

assert('stroke-width у всех stroke-based symbol в диапазоне 1.5–2', () => {
  const violations = [];
  for (const symbol of symbols) {
    const sw = symbol.getAttribute('stroke-width');
    if (!sw) continue;
    const val = parseFloat(sw);
    if (isNaN(val) || val < 1.5 || val > 2) {
      violations.push(`${symbol.getAttribute('id')}: stroke-width="${sw}"`);
    }
  }
  if (violations.length > 0) {
    throw new Error(`stroke-width вне [1.5, 2]:\n    ${violations.join('\n    ')}`);
  }
});

assert('property-based: stroke-width каждого symbol в допустимом диапазоне', () => {
  const strokeBased = symbols.filter(s => s.getAttribute('stroke-width'));
  if (strokeBased.length === 0) return;
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: strokeBased.length - 1 }),
      (i) => {
        const sw = parseFloat(strokeBased[i].getAttribute('stroke-width'));
        return !isNaN(sw) && sw >= 1.5 && sw <= 2;
      }
    ),
    { numRuns: 100 }
  );
});

// ─── Property 7: каждый symbol содержит <title> ───────────────────────────

console.log('\n=== Property 7: каждый symbol содержит <title> ===');
// Feature: emoji-to-svg-icons, Property 7: дочерний <title> с непустым текстом

assert('каждый symbol имеет дочерний <title> с непустым текстом', () => {
  const violations = [];
  for (const symbol of symbols) {
    const id = symbol.getAttribute('id') || '(без id)';
    const titles = symbol.getElementsByTagName('title');
    if (titles.length === 0) { violations.push(`${id}: нет <title>`); continue; }
    if ((titles[0].textContent || '').trim() === '') violations.push(`${id}: <title> пустой`);
  }
  if (violations.length > 0) {
    throw new Error(`Проблемы с <title>:\n    ${violations.join('\n    ')}`);
  }
});

assert('property-based: случайный symbol имеет непустой <title>', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: symbols.length - 1 }),
      (i) => {
        const titles = symbols[i].getElementsByTagName('title');
        return titles.length > 0 && (titles[0].textContent || '').trim().length > 0;
      }
    ),
    { numRuns: 100 }
  );
});

// ─── Итог ─────────────────────────────────────────────────────────────────

console.log(`\n=== Итог: ${passed} прошло, ${failed} упало ===\n`);
if (failed > 0) process.exit(1);
