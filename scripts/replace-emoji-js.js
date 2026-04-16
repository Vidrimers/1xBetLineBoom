#!/usr/bin/env node
// Скрипт замены эмоджи в js/modules/*.js на SVG иконки
// Запуск: node scripts/replace-emoji-js.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── Вспомогательная функция: SVG иконка ──────────────────────────────────
function icon(name, ariaLabel = null) {
  if (ariaLabel) {
    return `<svg class="icon" role="img" aria-label="${ariaLabel}"><use href="#${name}"></use></svg>`;
  }
  return `<svg class="icon" aria-hidden="true"><use href="#${name}"></use></svg>`;
}

// ─── Таблица замен: эмоджи → icon-name ────────────────────────────────────
// Только те эмоджи, которые встречаются в UI-контексте js/modules/
const EMOJI_MAP = {
  '💰': 'icon-bets',
  '👥': 'icon-participants',
  '👤': 'icon-profile',
  '📢': 'icon-news',
  '⚙️': 'icon-settings',
  '⚙': 'icon-settings',
  '🔐': 'icon-login',
  '📅': 'icon-tournaments',
  '⚽': 'icon-matches',
  '📊': 'icon-stats',
  '📋': 'icon-members',
  '⚖️': 'icon-compare',
  '⚖': 'icon-compare',
  '✅': 'icon-correct',
  '❌': 'icon-wrong',
  '⏳': 'icon-pending',
  '🔒': 'icon-hidden',
  '🟨': 'icon-yellow-card',
  '🟥': 'icon-red-card',
  '➕': 'icon-create',
  '✏️': 'icon-edit',
  '✏': 'icon-edit',
  '✎': 'icon-edit',
  '🗑️': 'icon-delete',
  '🗑': 'icon-delete',
  '🔄': 'icon-refresh',
  '📤': 'icon-submit',
  '📥': 'icon-import',
  '💾': 'icon-save',
  '🔍': 'icon-search',
  '🏆': 'icon-trophy',
  '🌍': 'icon-world-cup',
  '🏅': 'icon-conference',
  '🎯': 'icon-custom-tournament',
  '🔔': 'icon-bell',
  '📱': 'icon-telegram',
  '🔕': 'icon-muted',
  '⚠️': 'icon-warning',
  '⚠': 'icon-warning',
  '🥇': 'icon-winner',
  '⭐': 'icon-best-result',
  '🎖️': 'icon-special-award',
  '🎖': 'icon-special-award',
  '📷': 'icon-photo',
  '🐛': 'icon-bug',
  '🔑': 'icon-keywords',
  '📦': 'icon-backup',
  '🛡️': 'icon-moderator',
  '🛡': 'icon-moderator',
  '🤖': 'icon-bot',
  '🔴': 'icon-live',
  '🎨': 'icon-themes',
  '🎲': 'icon-lucky',
  '🔥': 'icon-streak',
  '😎': 'icon-place-1',
  '😐': 'icon-place-2',
  '💩': 'icon-place-3',
  '👑': 'icon-crown',
  '🌐': 'icon-globe',
  '💡': 'icon-hint',
  '🚀': 'icon-fast',
  '❓': 'icon-question',
  'ℹ️': 'icon-info',
  'ℹ': 'icon-info',
  '📎': 'icon-attach',
  '🎉': 'icon-celebrate',
  '✨': 'icon-sparkle',
  '⏰': 'icon-clock',
  '🕐': 'icon-clock',
  '👁️': 'icon-visible',
  '👁': 'icon-visible',
  '🖼️': 'icon-image',
  '🖼': 'icon-image',
  '📐': 'icon-crop',
  '🌓': 'icon-transparency',
  '📸': 'icon-avatar',
  '🔧': 'icon-tools',
  '🛠️': 'icon-tools',
  '🛠': 'icon-tools',
  '📝': 'icon-manual',
  '⬇️': 'icon-auto',
  '⬇': 'icon-auto',
  '⬆️': 'icon-auto',
  '⬆': 'icon-auto',
  '⏸️': 'icon-stop',
  '⏹️': 'icon-stop',
  '💬': 'icon-group',
  '👀': 'icon-views',
  '📜': 'icon-earlier',
  '📣': 'icon-announcements',
  '🔓': 'icon-visible',
  '👍': 'icon-correct',
  '👎': 'icon-wrong',
  '⏱️': 'icon-clock',
};

// ─── Эмоджи, которые НЕ заменяются (серверные логи, не UI) ────────────────
// Эти встречаются только в console.log/warn/error — пропускаем строки с ними
const SERVER_ONLY_EMOJI = new Set([
  '📈', '📌', '📄', '📡', '📁', '📂', '📰', '📧', '📨', '📬', '📭',
  '📲', '📺', '📖', '🔗', '🔓', '🔢', '🔵', '🟢', '🟡', '🗄', '🗓',
  '🧪', '🧹', '🏁', '⚡', '☰', '🔘', '🔊', '🔇', '🖥', '🖱', '💻',
  '🐧', '🚫', '⛔', '🎬', '🎂', '🍀', '🎭', '🎮', '🌃', '🌅', '🌙',
  '🔮', '☁', '☀', '➡', '📈', '🥈', '🥉', '☆',
]);

// ─── Найти все JS-файлы ────────────────────────────────────────────────────
function findFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findFiles(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

// ─── Проверить: является ли строка console-вызовом ────────────────────────
function isConsoleLine(line) {
  return /console\.(log|warn|error|info|debug)\s*\(/.test(line);
}

// ─── Проверить: является ли строка вызовом alert/confirm ──────────────────
function isAlertLine(line) {
  // alert() с эмоджи в тексте — оставляем (нативный диалог)
  return /^\s*(if\s*\(.*\)\s*\{?\s*)?alert\s*\(/.test(line);
}

// ─── Проверить: является ли строка аргументом иконки в showCustomAlert ────
// showCustomAlert(msg, title, 'EMOJI') — 3-й аргумент
function isIconArgument(line) {
  // Строки вида: '✅', "❌", '⚠️' — одиночный эмоджи как аргумент функции
  return /^\s*['"][^'"]{0,5}['"]\s*[,)]\s*$/.test(line.trim()) ||
         /showCustomAlert\(.*,\s*['"][^'"]{0,5}['"]\s*\)/.test(line) ||
         /showCustomConfirm\(.*,\s*['"][^'"]{0,5}['"]\s*\)/.test(line) ||
         /showCustomSaveConfirm\(.*,\s*['"][^'"]{0,5}['"]\s*\)/.test(line) ||
         /showCustomPrompt\(.*,\s*['"][^'"]{0,5}['"]\s*\)/.test(line);
}

// ─── Проверить: является ли строка проверкой includes() для логов ─────────
function isIncludesCheck(line) {
  return /\.includes\s*\(\s*['"]/.test(line) && /line\.includes/.test(line);
}

// ─── Проверить: является ли строка data-value или ключом объекта ──────────
function isDataKey(line) {
  // "🏆": "Стандартный" — ключ объекта
  return /^\s*['"][^'"]*['"]\s*:\s*['"]/.test(line.trim());
}

// ─── Проверить: является ли строка строковым значением тура ──────────────
function isTourValue(line) {
  // "🏆 Финал" — строковое значение тура (не заменяем)
  return /["']🏆\s*Финал["']/.test(line);
}

// ─── Основная функция замены ──────────────────────────────────────────────
function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let changed = false;
  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const original = line;

    // Пропускаем console.log/warn/error строки
    if (isConsoleLine(line)) {
      newLines.push(line);
      continue;
    }

    // Пропускаем строки с проверкой includes() для логов
    if (isIncludesCheck(line)) {
      newLines.push(line);
      continue;
    }

    // Пропускаем строки с "🏆 Финал" (строковые значения туров)
    if (isTourValue(line)) {
      newLines.push(line);
      continue;
    }

    // Пропускаем ключи объектов вида "🏆": "..."
    if (isDataKey(line)) {
      newLines.push(line);
      continue;
    }

    // Проверяем наличие эмоджи в строке
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}]/gu;
    if (!emojiRegex.test(line)) {
      newLines.push(line);
      continue;
    }

    // Определяем контекст строки
    const isHtmlContext = /innerHTML|textContent|innerText|\.html\s*=|template|`[^`]*<[a-z]/.test(line) ||
                          /<[a-z]/.test(line) ||
                          /`/.test(line);

    const isShowCustomAlert = /showCustomAlert|showCustomConfirm|showCustomSaveConfirm|showCustomPrompt/.test(line);
    const isAlertCall = isAlertLine(line);

    // Для каждого эмоджи в строке
    for (const [emoji, iconName] of Object.entries(EMOJI_MAP)) {
      if (!line.includes(emoji)) continue;

      // Пропускаем серверные эмоджи
      if (SERVER_ONLY_EMOJI.has(emoji)) continue;

      // Специальная обработка для btn.textContent = "⬇️ Auto" и "⏸️ Стоп"
      if (/btn\.textContent\s*=/.test(line) || /\.textContent\s*=/.test(line)) {
        // Заменяем эмоджи в textContent на SVG
        line = line.replace(emoji, icon(iconName));
        changed = true;
        continue;
      }

      // Для showCustomAlert — не заменяем иконку-аргумент (3-й параметр)
      // Но заменяем эмоджи в тексте сообщения если они в HTML-контексте
      if (isShowCustomAlert) {
        // Проверяем: эмоджи в тексте сообщения (первый аргумент) или в иконке (3-й аргумент)?
        // Если строка содержит HTML-теги в первом аргументе — заменяем
        if (/<[a-z]/.test(line)) {
          line = line.replace(new RegExp(emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), icon(iconName));
          changed = true;
        }
        // Иначе — не трогаем (это иконка модального окна или текст без HTML)
        continue;
      }

      // Для alert() — не трогаем
      if (isAlertCall) continue;

      // Для HTML-контекста — заменяем на SVG
      if (isHtmlContext) {
        line = line.replace(new RegExp(emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), icon(iconName));
        changed = true;
        continue;
      }

      // Для переменных emoji = "😎" — заменяем на SVG-строку
      if (/^\s*(let|const|var)\s+emoji\s*=/.test(line) || /^\s*emoji\s*=/.test(line)) {
        line = line.replace(new RegExp('"' + emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g'), `'${icon(iconName)}'`);
        line = line.replace(new RegExp("'" + emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'", 'g'), `'${icon(iconName)}'`);
        changed = true;
        continue;
      }
    }

    newLines.push(line);
    if (line !== original) changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, newLines.join('\n'), 'utf-8');
    return true;
  }
  return false;
}

// ─── Запуск ───────────────────────────────────────────────────────────────
const jsDir = path.join(ROOT, 'js/modules');
const files = findFiles(jsDir);

let totalChanged = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (processFile(file)) {
    console.log(`✓ Обработан: ${rel}`);
    totalChanged++;
  }
}

console.log(`\nИтого изменено файлов: ${totalChanged} из ${files.length}`);
