import fs from 'fs';

/**
 * Вспомогательная функция для определения статуса матча
 */
export function getMatchStatus(match) {
  const now = new Date();
  const matchDate = match.match_date ? new Date(match.match_date) : null;

  // Если есть результат - матч завершен
  if (match.winner) {
    return 'finished';
  }

  // Если нет даты - считаем ожидающим
  if (!matchDate) {
    return 'pending';
  }

  // Если дата в будущем - ожидает
  if (matchDate > now) {
    return 'pending';
  }

  // Если дата прошла, но нет результата - идет
  return 'ongoing';
}

/**
 * Нормализация названия команды для сопоставления с API
 */
export function normalizeTeamNameForAPI(name) {
  if (!name) return '';

  // Удаляем диакритику
  const withoutDiacritics = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return withoutDiacritics
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9\u0400-\u04FF\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Перевести русское название команды в английское для сопоставления с API
 */
export function translateTeamNameToEnglish(russianName, competitionCode) {
  if (!russianName) return russianName;

  // Загружаем словарь для турнира
  const dictionaryFiles = {
    CL: 'names/LeagueOfChampionsTeams.json',
    EL: 'names/EuropaLeague.json',
    ECL: 'names/ConferenceLeague.json',
    PL: 'names/PremierLeague.json',
    LL: 'names/LaLiga.json',
    SA: 'names/SerieA.json',
    BL: 'names/Bundesliga.json',
    L1: 'names/Ligue1.json',
    ED: 'names/Eredivisie.json',
    RPL: 'names/RussianPremierLeague.json',
    WC: 'names/Countries.json',  // Чемпионат мира
    EC: 'names/Countries.json',  // Чемпионат Европы
  };

  const dictionaryFile = dictionaryFiles[competitionCode];
  if (!dictionaryFile) {
    return russianName; // Нет словаря для этого турнира
  }

  try {
    const dictionary = JSON.parse(fs.readFileSync(dictionaryFile, 'utf8'));
    const teams = dictionary.teams || {};

    // Сначала ищем точное совпадение по ключу (русское -> английское)
    let englishName = teams[russianName];
    if (englishName) {
      return englishName;
    }

    // Если не найдено, ищем без учёта регистра по ключу
    const lowerRussianName = russianName.toLowerCase();
    for (const [key, value] of Object.entries(teams)) {
      if (key.toLowerCase() === lowerRussianName) {
        return value;
      }
    }

    // Если название уже на латинице (например, "USA", "Congo DR" — уже английское в БД),
    // ищем его как значение в словаре и возвращаем как есть
    const normalizedInput = normalizeTeamNameForAPI(russianName);
    for (const [, value] of Object.entries(teams)) {
      if (normalizeTeamNameForAPI(value) === normalizedInput) {
        return value; // возвращаем каноническое английское название из словаря
      }
    }

    // Если не найден перевод, возвращаем оригинал
    return russianName;
  } catch (error) {
    console.error(`⚠️ Ошибка загрузки словаря ${dictionaryFile}:`, error.message);
    return russianName;
  }
}

/**
 * Нормализация названия команды (убираем FC, AC и т.д.)
 * Используется локально внутри autoCountingService при сопоставлении матчей
 */
export function normalizeTeamName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\bfc\b|\bac\b|\bsc\b|\bfk\b|\bsk\b|\bif\b|\bik\b|\bbk\b|\bvfb\b|\bvfl\b|\btsv\b|\bfsv\b|\bsv\b|\brc\b|\bcd\b|\bud\b|\bsd\b|\bcf\b|\baf\b|\bpfc\b|\bfcb\b/gi, '')
    .replace(/[^a-z0-9\u0400-\u04FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
