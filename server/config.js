import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Корень проекта (на уровень выше папки server/)
export const ROOT_DIR = path.resolve(__dirname, "..");

export const PORT = process.env.PORT || 1984;
export const SERVER_IP = process.env.SERVER_IP || "localhost";
export const SSTATS_API_KEY = process.env.SSTATS_API_KEY;
export const SSTATS_API_BASE = "https://api.sstats.net";

// Маппинг кодов турниров на SStats League IDs
export const SSTATS_LEAGUE_MAPPING = {
  'CL': 2,    // UEFA Champions League ✅
  'EL': 3,    // UEFA Europa League ✅
  'ECL': 848, // UEFA Conference League ✅
  'PL': 39,   // Premier League ✅
  'BL1': 78,  // Bundesliga ✅
  'PD': 140,  // La Liga ✅
  'SA': 135,  // Serie A ✅
  'FL1': 61,  // Ligue 1 ✅
  'DED': 88,  // Eredivisie ✅
  'RPL': 235, // Russian Premier League ✅
  'WC': 1,    // World Cup ✅
  'EC': 4     // Euro Championship ✅
};

// Маппинг кодов турниров на файлы словарей команд
export const COMPETITION_DICTIONARY_MAPPING = {
  'CL': 'names/LeagueOfChampionsTeams.json',
  'EL': 'names/EuropaLeague.json',
  'ECL': 'names/ConferenceLeague.json',
  'PL': 'names/PremierLeague.json',
  'BL1': 'names/Bundesliga.json',
  'PD': 'names/LaLiga.json',
  'SA': 'names/SerieA.json',
  'FL1': 'names/Ligue1.json',
  'DED': 'names/Eredivisie.json',
  'RPL': 'names/RussianPremierLeague.json',
  'WC': 'names/Countries.json',  // World Cup
  'EC': 'names/Countries.json'   // Euro Championship
};

// Маппинг кодов турниров на файлы словарей игроков
export const PLAYERS_DICTIONARY_MAPPING = {
  'CL': 'names/LeagueOfChampionsPlayers.json',
  'EL': 'names/EuropaLeaguePlayers.json',
  'ECL': 'names/ConferenceLeaguePlayers.json',
  'PL': 'names/PremierLeaguePlayers.json',
  'BL1': 'names/BundesligaPlayers.json',
  'PD': 'names/LaLigaPlayers.json',
  'SA': 'names/SerieAPlayers.json',
  'FL1': 'names/Ligue1Players.json',
  'DED': 'names/EredivisiePlayers.json',
  'RPL': 'names/RussianPremierLeaguePlayers.json',
  'WC': 'names/PlayerNames.json',  // World Cup - общий словарь
  'EC': 'names/PlayerNames.json'   // Euro Championship - общий словарь
};

// Маппинг иконок турниров на коды для API
export const ICON_TO_COMPETITION = {
  'img/cups/champions-league.png': 'CL',
  'img/cups/european-league.png': 'EL',
  'img/cups/conference-league.png': 'ECL',
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

// Путь к папке с бэкапами
export const BACKUPS_DIR = path.join(ROOT_DIR, "backups");

// Путь к файлу логов
export const LOG_FILE_PATH = path.join(ROOT_DIR, "log.html");
export const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

// Путь к файлу логов терминала
export const TERMINAL_LOGS_PATH = path.join(ROOT_DIR, "terminal-logs.txt");
export const MAX_TERMINAL_LOGS_SIZE = 5 * 1024 * 1024; // 5 MB

// Папка для загрузки изображений наград
export const AWARD_IMAGE_UPLOAD_DIR = path.join(ROOT_DIR, "uploads", "award-images");
