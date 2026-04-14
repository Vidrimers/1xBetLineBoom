const fs = require('fs');
const path = require('path');

// Корень проекта
const ROOT_DIR = path.join(__dirname, '../..');

// Читаем оба файла
const existingFile = path.join(ROOT_DIR, 'names/LeagueOfChampionsPlayers.json');
const parsedFile = path.join(ROOT_DIR, 'temp/LeagueOfChampionsPlayers_parsed.json');

const existing = JSON.parse(fs.readFileSync(existingFile, 'utf-8'));
const parsed = JSON.parse(fs.readFileSync(parsedFile, 'utf-8'));

console.log(`📊 Существующих переводов: ${Object.keys(existing).length}`);
console.log(`📊 Спарсено игроков: ${Object.keys(parsed).length}`);

// Создаем обратный маппинг: English -> Russian из существующего файла
const englishToRussian = {};
for (const [russian, english] of Object.entries(existing)) {
  englishToRussian[english] = russian;
}

// Добавляем новых игроков (которых еще нет в переводах)
let newPlayers = 0;
for (const englishName of Object.keys(parsed)) {
  if (!englishToRussian[englishName]) {
    // Пока оставляем английское имя как ключ (нужно будет перевести вручную)
    englishToRussian[englishName] = englishName;
    newPlayers++;
  }
}

console.log(`✅ Добавлено новых игроков: ${newPlayers}`);

// Создаем финальный объект: Russian -> English
const final = {};
for (const [english, russian] of Object.entries(englishToRussian)) {
  final[russian] = english;
}

// Удаляем дубликаты (оставляем только уникальные пары)
const uniqueFinal = {};
const seenEnglish = new Set();

for (const [russian, english] of Object.entries(final)) {
  if (!seenEnglish.has(english)) {
    uniqueFinal[russian] = english;
    seenEnglish.add(english);
  } else {
    console.log(`⚠️ Удален дубликат: "${russian}" -> "${english}"`);
  }
}

// Сортируем по русскому алфавиту
const sortedKeys = Object.keys(uniqueFinal).sort((a, b) => a.localeCompare(b, 'ru'));
const sorted = {};
for (const key of sortedKeys) {
  sorted[key] = uniqueFinal[key];
}

console.log(`📊 Итого уникальных игроков: ${Object.keys(sorted).length}`);

// Сохраняем
fs.writeFileSync(existingFile, JSON.stringify(sorted, null, 2), 'utf-8');

console.log(`✅ Файл обновлен: ${existingFile}`);

// Сохраняем список игроков без перевода
const needTranslation = [];
for (const [russian, english] of Object.entries(sorted)) {
  if (russian === english) {
    needTranslation.push(english);
  }
}

if (needTranslation.length > 0) {
  const needTranslationFile = path.join(ROOT_DIR, 'temp/need-translation.txt');
  fs.writeFileSync(needTranslationFile, needTranslation.join('\n'), 'utf-8');
  console.log(`\n📝 Игроков без перевода: ${needTranslation.length}`);
  console.log(`📁 Список сохранен в: temp/need-translation.txt`);
  console.log(`\n💡 Первые 20 игроков без перевода:`);
  needTranslation.slice(0, 20).forEach(name => console.log(`  - ${name}`));
}
