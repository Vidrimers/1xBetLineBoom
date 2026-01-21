# Маппинги турниров и словарей

Этот документ описывает маппинги, используемые в системе для связи турниров с их кодами, API и словарями команд.

## 1. ICON_TO_COMPETITION

Маппинг иконок турниров на коды для API.

**Расположение:**
- `server.js` (строка ~13125)
- `js/index.js` (строка ~11754)

**Структура:**
```javascript
const ICON_TO_COMPETITION = {
  'img/cups/champions-league.png': 'CL',
  'img/cups/european-league.png': 'EL',
  'img/cups/england-premier-league.png': 'PL',
  'img/cups/bundesliga.png': 'BL1',
  'img/cups/spain-la-liga.png': 'PD',
  'img/cups/serie-a.png': 'SA',
  'img/cups/france-league-ligue-1.png': 'FL1',
  'img/cups/rpl.png': 'RPL',
  'img/cups/world-cup.png': 'WC',
  'img/cups/uefa-euro.png': 'EC',
  '🇳🇱': 'DED'  // Eredivisie
};
```

## 2. SSTATS_LEAGUE_MAPPING

Маппинг кодов турниров на SStats League IDs для API запросов.

**Расположение:**
- `server.js` (строка ~40)

**Структура:**
```javascript
const SSTATS_LEAGUE_MAPPING = {
  'CL': 2,    // UEFA Champions League
  'EL': 3,    // UEFA Europa League
  'PL': 39,   // Premier League
  'BL1': 78,  // Bundesliga
  'PD': 140,  // La Liga
  'SA': 135,  // Serie A
  'FL1': 61,  // Ligue 1
  'DED': 88,  // Eredivisie
  'RPL': 235, // Russian Premier League
  'WC': 1,    // World Cup
  'EC': 4     // Euro Championship
};
```

## 3. COMPETITION_DICTIONARY_MAPPING

Маппинг кодов турниров на файлы словарей команд для перевода английских названий в русские.

**Расположение:**
- `server.js` (строка ~54)
- `js/counting.js` (строка ~3)

**Структура:**
```javascript
const COMPETITION_DICTIONARY_MAPPING = {
  'CL': 'names/LeagueOfChampionsTeams.json',
  'EL': 'names/EuropaLeague.json',
  'PL': 'names/PremierLeague.json',
  'BL1': 'names/Bundesliga.json',
  'PD': 'names/LaLiga.json',
  'SA': 'names/SerieA.json',
  'FL1': 'names/Ligue1.json',
  'DED': 'names/Eredivisie.json',
  'RPL': 'names/RussianPremierLeague.json',
  'WC': null,  // World Cup - словарь не требуется
  'EC': null   // Euro Championship - словарь не требуется
};
```

## Коды турниров

| Код | Турнир | Иконка | SStats ID | Словарь |
|-----|--------|--------|-----------|---------|
| CL | UEFA Champions League | img/cups/champions-league.png | 2 | LeagueOfChampionsTeams.json |
| EL | UEFA Europa League | img/cups/european-league.png | 3 | EuropaLeague.json |
| PL | Premier League | img/cups/england-premier-league.png | 39 | PremierLeague.json |
| BL1 | Bundesliga | img/cups/bundesliga.png | 78 | Bundesliga.json |
| PD | La Liga | img/cups/spain-la-liga.png | 140 | LaLiga.json |
| SA | Serie A | img/cups/serie-a.png | 135 | SerieA.json |
| FL1 | Ligue 1 | img/cups/france-league-ligue-1.png | 61 | Ligue1.json |
| DED | Eredivisie | 🇳🇱 | 88 | Eredivisie.json |
| RPL | Russian Premier League | img/cups/rpl.png | 235 | RussianPremierLeague.json |
| WC | World Cup | img/cups/world-cup.png | 1 | - |
| EC | Euro Championship | img/cups/uefa-euro.png | 4 | - |

## Использование

### Определение турнира по иконке
```javascript
const event = db.prepare("SELECT icon FROM events WHERE id = ?").get(eventId);
const competition = ICON_TO_COMPETITION[event.icon];
```

### Получение League ID для API
```javascript
const leagueId = SSTATS_LEAGUE_MAPPING[competition];
```

### Загрузка словаря команд
```javascript
const dictionaryFile = COMPETITION_DICTIONARY_MAPPING[competition];
if (dictionaryFile) {
  const mappingData = JSON.parse(fs.readFileSync(path.join(__dirname, dictionaryFile), 'utf-8'));
  const teamMapping = mappingData.teams || {};
}
```

## Добавление нового турнира

Чтобы добавить новый турнир:

1. Добавьте иконку в `ICON_TO_COMPETITION`
2. Добавьте League ID в `SSTATS_LEAGUE_MAPPING`
3. Создайте файл словаря в папке `names/`
4. Добавьте путь к словарю в `COMPETITION_DICTIONARY_MAPPING`

## Формат словаря команд

```json
{
  "tournament": "Название турнира",
  "description": "Описание",
  "teams": {
    "Русское название": "English Name",
    "Короткое": "Full English Name",
    "Полное название": "Full English Name"
  }
}
```

**Важно:** Если для одной английской команды есть несколько русских вариантов (короткое и полное), система автоматически выберет самое короткое название.
