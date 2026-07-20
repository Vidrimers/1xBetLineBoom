import { db } from "./db.js";

// Функция для запуска миграций таблицы users
export function runUsersMigrations() {
  console.log("🔄 Запуск миграций для таблицы users...");

  // Миграция: добавляем telegram_username если его нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN telegram_username TEXT`);
    console.log("✅ Колонка telegram_username добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем avatar если его нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN avatar LONGTEXT`);
    console.log("✅ Колонка avatar добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем telegram_notifications_enabled если её нет
  try {
    db.exec(
      `ALTER TABLE users ADD COLUMN telegram_notifications_enabled INTEGER DEFAULT 1`
    );
    console.log(
      "✅ Колонка telegram_notifications_enabled добавлена в таблицу users"
    );
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем telegram_group_reminders_enabled если её нет
  try {
    db.exec(
      `ALTER TABLE users ADD COLUMN telegram_group_reminders_enabled INTEGER DEFAULT 1`
    );
    console.log(
      "✅ Колонка telegram_group_reminders_enabled добавлена в таблицу users"
    );
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем avatar_path если её нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN avatar_path TEXT`);
    console.log("✅ Колонка avatar_path добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем theme если её нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'theme-default'`);
    console.log("✅ Колонка theme добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем show_bets если её нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN show_bets TEXT DEFAULT 'always'`);
    console.log("✅ Колонка show_bets добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем show_lucky_button если её нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN show_lucky_button INTEGER DEFAULT 1`);
    console.log("✅ Колонка show_lucky_button добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем live_sound если её нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN live_sound INTEGER DEFAULT 0`);
    console.log("✅ Колонка live_sound добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем telegram_id если его нет
  try {
    db.exec(`ALTER TABLE users ADD COLUMN telegram_id TEXT UNIQUE`);
    console.log("✅ Колонка telegram_id добавлена в таблицу users");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  console.log("✅ Миграции для таблицы users завершены");
}

// Инициализация всех таблиц БД
export function initDatabase() {
  // Таблица пользователей
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      telegram_username TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Запускаем миграции для таблицы users
  runUsersMigrations();

  // Таблица настроек системы
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Инициализируем настройку автоподсчета если её нет
  const autoCountingSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'auto_counting_enabled'").get();
  if (!autoCountingSetting) {
    db.prepare("INSERT INTO system_settings (key, value) VALUES ('auto_counting_enabled', 'true')").run();
  }

  // Таблица для связки telegram username → chat_id (для отправки личных сообщений)
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_username TEXT UNIQUE NOT NULL,
      chat_id INTEGER NOT NULL,
      first_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица для отслеживания событий матчей (голы, карточки) для уведомлений
  db.exec(`
    CREATE TABLE IF NOT EXISTS match_events_sent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(match_id, event_id, user_id)
    )
  `);

  // Таблица событий (Лиги, турниры)
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      start_date DATETIME,
      end_date DATETIME,
      icon TEXT DEFAULT '🏆',
      background_color TEXT DEFAULT 'rgba(224, 230, 240, .4)',
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица матчей (с командами)
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      team1_name TEXT NOT NULL,
      team2_name TEXT NOT NULL,
      match_date DATETIME,
      status TEXT DEFAULT 'pending',
      winner TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id)
    )
  `);

  // Таблица ставок пользователей
  db.exec(`
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      prediction TEXT NOT NULL,
      amount REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (match_id) REFERENCES matches(id)
    )
  `);

  // Таблица прогнозов на счет
  db.exec(`
    CREATE TABLE IF NOT EXISTS score_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      score_team1 INTEGER NOT NULL,
      score_team2 INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (match_id) REFERENCES matches(id),
      UNIQUE(user_id, match_id)
    )
  `);

  // Таблица прогнозов на карточки
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      yellow_cards INTEGER,
      red_cards INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (match_id) REFERENCES matches(id),
      UNIQUE(user_id, match_id)
    )
  `);

  // Таблица фактических счетов матчей
  db.exec(`
    CREATE TABLE IF NOT EXISTS match_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL UNIQUE,
      score_team1 INTEGER NOT NULL,
      score_team2 INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES matches(id)
    )
  `);

  // Таблица настроек сайта + финальные параметры + модераторы + награды пользователей
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS final_parameters_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL UNIQUE,
      exact_score TEXT,
      yellow_cards INTEGER,
      red_cards INTEGER,
      corners INTEGER,
      penalties_in_game TEXT,
      extra_time TEXT,
      penalties_at_end TEXT,
      goal_difference TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES matches(id)
    );

    CREATE TABLE IF NOT EXISTS moderators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      permissions TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_id INTEGER,
      award_type TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      background_opacity REAL DEFAULT 1,
      award_color TEXT DEFAULT '#fbc02d',
      award_emoji TEXT DEFAULT '🏆',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (event_id) REFERENCES events(id)
    )
  `);

  // Таблица для автоматических наград за турниры
  db.exec(`
    CREATE TABLE IF NOT EXISTS awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      won_bets_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (event_id) REFERENCES events(id)
    )
  `);

  // Таблица для отслеживания отправленных напоминаний о голосовании
  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES matches(id)
    )
  `);

  // Таблица для отслеживания отправленных уведомлений за 3 часа до матча
  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_3hour_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES matches(id)
    )
  `);

  // Таблица для отслеживания отправленных персональных напоминаний из модального окна
  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_personal_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (match_id) REFERENCES matches(id),
      UNIQUE(user_id, match_id)
    )
  `);

  // Таблица для хранения ожидающих публикации объявлений о турнирах
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      start_date TEXT,
      end_date TEXT,
      message TEXT NOT NULL,
      username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица сеток плей-офф
  db.exec(`
    CREATE TABLE IF NOT EXISTS brackets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_date DATETIME NOT NULL,
      start_stage TEXT DEFAULT 'round_of_16',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id)
    )
  `);

  // Таблица прогнозов пользователей в сетке
  db.exec(`
    CREATE TABLE IF NOT EXISTS bracket_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bracket_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      match_index INTEGER NOT NULL,
      predicted_winner TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bracket_id) REFERENCES brackets(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(bracket_id, user_id, stage, match_index)
    )
  `);

  // Таблица фактических результатов матчей в сетке (для админа)
  db.exec(`
    CREATE TABLE IF NOT EXISTS bracket_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bracket_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      match_index INTEGER NOT NULL,
      actual_winner TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bracket_id) REFERENCES brackets(id),
      UNIQUE(bracket_id, stage, match_index)
    )
  `);

  // Таблица настроек напоминаний о матчах турнира
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      hours_before INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (event_id) REFERENCES events(id),
      UNIQUE(user_id, event_id)
    )
  `);

  // Таблица детальных настроек уведомлений пользователя
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_notification_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      match_reminders INTEGER DEFAULT 1,
      three_hour_reminders INTEGER DEFAULT 1,
      only_active_tournaments INTEGER DEFAULT 0,
      tournament_announcements INTEGER DEFAULT 1,
      match_results INTEGER DEFAULT 1,
      system_messages INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Таблица багрепортов
  db.exec(`
    CREATE TABLE IF NOT EXISTS bug_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      bug_text TEXT NOT NULL,
      status TEXT DEFAULT 'new',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Таблица изображений багрепортов
  db.exec(`
    CREATE TABLE IF NOT EXISTS bug_report_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bug_report_id INTEGER NOT NULL,
      image_data TEXT NOT NULL,
      image_name TEXT,
      image_size INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bug_report_id) REFERENCES bug_reports(id) ON DELETE CASCADE
    )
  `);

  // Таблица для хранения обработанных дат автоподсчета
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_counting_processed (
      date_key TEXT PRIMARY KEY,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Таблица категорий весов турниров
  db.exec(`
    CREATE TABLE IF NOT EXISTS weight_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      weight INTEGER NOT NULL DEFAULT 1,
      label TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Заполняем дефолтные категории весов если таблица пуста
  const weightCount = db.prepare("SELECT COUNT(*) as count FROM weight_categories").get();
  if (weightCount.count === 0) {
    const insertWeight = db.prepare("INSERT INTO weight_categories (weight, label) VALUES (?, ?)");
    insertWeight.run(10, "ЧМ и ЧЕ");
    insertWeight.run(6, "Лига Чемпионов");
    insertWeight.run(4, "ЛЕ и ЛК");
    insertWeight.run(1, "Нац.лиги, нац.кубки");
    console.log("✅ Дефолтные категории весов турниров добавлены");
  }

  // Миграция: добавляем weight_category_id в events если его нет
  try {
    db.exec(`ALTER TABLE events ADD COLUMN weight_category_id INTEGER REFERENCES weight_categories(id)`);
    console.log("✅ Колонка weight_category_id добавлена в таблицу events");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }
}
