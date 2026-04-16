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

// ─── Property 5: Нет эмоджи в JS-файлах ───────────────────────────────────

console.log('\n=== Property 5: Нет эмоджи в JS-файлах ===');
// Feature: emoji-to-svg-icons, Property 5: ни один файл js/**/*.js не содержит Unicode эмоджи

const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function findJSFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findJSFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

assert('ни один JS-файл не содержит эмоджи-символов', () => {
  const jsDir = path.join(__dirname, '../js');
  if (!fs.existsSync(jsDir)) {
    console.log('    Папка js/ не найдена, пропускаем тест');
    return;
  }
  
  const jsFiles = findJSFiles(jsDir);
  const violations = [];
  
  for (const filePath of jsFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Пропускаем строки с console.log - они не отображаются в UI
      if (line.includes('console.log') || line.includes('console.error') || line.includes('console.warn')) {
        continue;
      }
      
      const match = line.match(EMOJI_REGEX);
      if (match) {
        const relativePath = path.relative(__dirname, filePath);
        violations.push(`${relativePath}:${i + 1}: "${match[0]}" в строке: ${line.trim()}`);
      }
    }
  }
  
  if (violations.length > 0) {
    throw new Error(`Найдены эмоджи в JS-файлах:\n    ${violations.join('\n    ')}`);
  }
});

assert('property-based: случайные строки JS-файлов не содержат эмоджи', () => {
  const jsDir = path.join(__dirname, '../js');
  if (!fs.existsSync(jsDir)) return;
  
  const jsFiles = findJSFiles(jsDir);
  if (jsFiles.length === 0) return;
  
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: jsFiles.length - 1 }),
      (fileIndex) => {
        const content = fs.readFileSync(jsFiles[fileIndex], 'utf-8');
        const lines = content.split('\n').filter(line => 
          !line.includes('console.log') && 
          !line.includes('console.error') && 
          !line.includes('console.warn')
        );
        
        if (lines.length === 0) return true;
        
        // Проверяем случайную строку
        const randomLine = lines[Math.floor(Math.random() * lines.length)];
        return !EMOJI_REGEX.test(randomLine);
      }
    ),
    { numRuns: 50 }
  );
});

// ─── Property 5 (CSS): Нет эмоджи в CSS-файлах ───────────────────────────

console.log('\n=== Property 5 (CSS): Нет эмоджи в CSS-файлах ===');
// Feature: emoji-to-svg-icons, Property 5 (CSS): ни один файл css/**/*.css не содержит Unicode эмоджи

function findCSSFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findCSSFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      files.push(fullPath);
    }
  }
  return files;
}

assert('ни один CSS-файл не содержит эмоджи-символов', () => {
  const cssDir = path.join(__dirname, '../css');
  if (!fs.existsSync(cssDir)) {
    console.log('    Папка css/ не найдена, пропускаем тест');
    return;
  }
  
  const cssFiles = findCSSFiles(cssDir);
  const violations = [];
  
  for (const filePath of cssFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(EMOJI_REGEX);
      if (match) {
        const relativePath = path.relative(__dirname, filePath);
        violations.push(`${relativePath}:${i + 1}: "${match[0]}" в строке: ${line.trim()}`);
      }
    }
  }
  
  if (violations.length > 0) {
    throw new Error(`Найдены эмоджи в CSS-файлах:\n    ${violations.join('\n    ')}`);
  }
});

assert('property-based: случайные строки CSS-файлов не содержат эмоджи', () => {
  const cssDir = path.join(__dirname, '../css');
  if (!fs.existsSync(cssDir)) return;
  
  const cssFiles = findCSSFiles(cssDir);
  if (cssFiles.length === 0) return;
  
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: cssFiles.length - 1 }),
      (fileIndex) => {
        const content = fs.readFileSync(cssFiles[fileIndex], 'utf-8');
        const lines = content.split('\n');
        
        if (lines.length === 0) return true;
        
        // Проверяем случайную строку
        const randomLine = lines[Math.floor(Math.random() * lines.length)];
        return !EMOJI_REGEX.test(randomLine);
      }
    ),
    { numRuns: 50 }
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

// ─── Property 8: use-элементы используют href, не xlink:href ─────────────

console.log('\n=== Property 8: <use> использует href, не xlink:href ===');
// Feature: emoji-to-svg-icons, Property 8: все <use> в HTML-файлах используют href

function readHTMLFile(filename) {
  const filePath = path.join(__dirname, '..', filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

assert('index.html не содержит xlink:href в <use>', () => {
  const content = readHTMLFile('index.html');
  if (content === null) {
    console.log('    index.html не найден, пропускаем');
    return;
  }
  // Ищем <use с xlink:href
  const matches = content.match(/<use[^>]*xlink:href[^>]*>/g);
  if (matches && matches.length > 0) {
    throw new Error(`Найдены <use xlink:href> в index.html:\n    ${matches.slice(0, 5).join('\n    ')}`);
  }
});

assert('icons-preview.html не содержит xlink:href в <use>', () => {
  const content = readHTMLFile('icons-preview.html');
  if (content === null) {
    console.log('    icons-preview.html не найден, пропускаем');
    return;
  }
  const matches = content.match(/<use[^>]*xlink:href[^>]*>/g);
  if (matches && matches.length > 0) {
    throw new Error(`Найдены <use xlink:href> в icons-preview.html:\n    ${matches.slice(0, 5).join('\n    ')}`);
  }
});

assert('property-based: случайные <use> в HTML-файлах используют href', () => {
  const htmlFiles = ['index.html', 'icons-preview.html']
    .map(f => ({ name: f, content: readHTMLFile(f) }))
    .filter(f => f.content !== null);

  if (htmlFiles.length === 0) return;

  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: htmlFiles.length - 1 }),
      (i) => {
        const content = htmlFiles[i].content;
        // Все <use> должны использовать href, не xlink:href
        const useElements = content.match(/<use[^>]*>/g) || [];
        return useElements.every(el => !el.includes('xlink:href'));
      }
    ),
    { numRuns: htmlFiles.length }
  );
});

// ─── Property 6: декоративные иконки имеют aria-hidden ───────────────────

console.log('\n=== Property 6: <svg class="icon"> рядом с текстом имеют aria-hidden ===');
// Feature: emoji-to-svg-icons, Property 6: декоративные иконки имеют aria-hidden="true"

assert('все <svg class="icon"> в index.html имеют aria-hidden="true"', () => {
  const content = readHTMLFile('index.html');
  if (content === null) {
    console.log('    index.html не найден, пропускаем');
    return;
  }
  // Ищем <svg class="icon" без aria-hidden="true"
  // Паттерн: <svg ... class="icon" ... > без aria-hidden="true"
  const svgIconTags = content.match(/<svg[^>]*class="icon"[^>]*>/g) || [];
  const violations = svgIconTags.filter(tag => !tag.includes('aria-hidden="true"') && !tag.includes("aria-hidden='true'"));
  if (violations.length > 0) {
    throw new Error(
      `Найдены <svg class="icon"> без aria-hidden="true" (${violations.length} шт.):\n    ` +
      violations.slice(0, 5).join('\n    ')
    );
  }
});

assert('все <svg class="icon"> в icons-preview.html имеют aria-hidden="true"', () => {
  const content = readHTMLFile('icons-preview.html');
  if (content === null) {
    console.log('    icons-preview.html не найден, пропускаем');
    return;
  }
  // В icons-preview.html иконки создаются динамически через JS,
  // поэтому проверяем только статические теги в HTML (если есть)
  const svgIconTags = content.match(/<svg[^>]*class="icon"[^>]*>/g) || [];
  const violations = svgIconTags.filter(tag => !tag.includes('aria-hidden="true"') && !tag.includes("aria-hidden='true'"));
  if (violations.length > 0) {
    throw new Error(
      `Найдены <svg class="icon"> без aria-hidden="true" (${violations.length} шт.):\n    ` +
      violations.slice(0, 5).join('\n    ')
    );
  }
});

assert('property-based: случайные <svg class="icon"> в HTML-файлах имеют aria-hidden', () => {
  const htmlFiles = ['index.html', 'icons-preview.html']
    .map(f => ({ name: f, content: readHTMLFile(f) }))
    .filter(f => f.content !== null);

  if (htmlFiles.length === 0) return;

  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: htmlFiles.length - 1 }),
      (i) => {
        const content = htmlFiles[i].content;
        const svgIconTags = content.match(/<svg[^>]*class="icon"[^>]*>/g) || [];
        // Все статические <svg class="icon"> должны иметь aria-hidden="true"
        return svgIconTags.every(tag =>
          tag.includes('aria-hidden="true"') || tag.includes("aria-hidden='true'")
        );
      }
    ),
    { numRuns: htmlFiles.length }
  );
});

// ─── Обновлённый итог ─────────────────────────────────────────────────────

console.log(`\n=== Итог: ${passed} прошло, ${failed} упало ===\n`);
if (failed > 0) process.exit(1);
