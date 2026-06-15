import { db } from "./db.js";

// ===== DATABASE MIGRATIONS =====

export function runMigrations() {
  // Добавляем колонку match_date если её нет
  try {
    db.prepare("ALTER TABLE matches ADD COLUMN match_date DATETIME").run();
  } catch (error) {
    // Колонка уже существует, это нормально
  }

  // Добавляем колонку locked_reason если её нет (для блокировки турниров)
  try {
    db.prepare("ALTER TABLE events ADD COLUMN locked_reason TEXT").run();
  } catch (error) {
    // Колонка уже существует, это нормально
  }

  // Добавляем колонку end_date если её нет (для конца турнира)
  try {
    db.prepare("ALTER TABLE events ADD COLUMN end_date DATETIME").run();
  } catch (error) {
    // Колонка уже существует, это нормально
  }

  // Добавляем колонку icon если её нет (для иконки турнира)
  try {
    db.prepare("ALTER TABLE events ADD COLUMN icon TEXT DEFAULT '🏆'").run();
  } catch (error) {
    // Колонка уже существует, это нормально
  }

  // Добавляем колонку background_color если её нет (для цвета фона турнира)
  try {
    db.prepare(
      "ALTER TABLE events ADD COLUMN background_color TEXT DEFAULT 'rgba(224, 230, 240, .4)'"
    ).run();
  } catch (error) {
    // Колонка уже существует, это нормально
  }

  // Добавляем колонку team_file если её нет (для словаря команд турнира)
  try {
    db.prepare("ALTER TABLE events ADD COLUMN team_file TEXT").run();
  } catch (error) {
    // Колонка уже существует, это нормально
  }

  // Добавляем колонку score_prediction_enabled если её нет (для прогноза на счет)
  try {
    db.prepare("ALTER TABLE matches ADD COLUMN score_prediction_enabled INTEGER DEFAULT 0").run();
  } catch (error) {
    // Колонка уже существует, это нормально
  }

  // Добавляем колонки для прогноза на карточки
  try {
    db.prepare("ALTER TABLE matches ADD COLUMN yellow_cards_prediction_enabled INTEGER DEFAULT 0").run();
  } catch (error) {
    // Колонка уже существует, это нормально
  }

  try {
    db.prepare("ALTER TABLE matches ADD COLUMN red_cards_prediction_enabled INTEGER DEFAULT 0").run();
  } catch (error) {
    // Колонка уже существует, это нормально
  }

  // Добавляем колонку result если её нет (для результата матча)
  try {
    db.prepare("ALTER TABLE matches ADD COLUMN result TEXT").run();
  } catch (error) {
    // Колонка уже существует, это нормально
  }

  // Добавляем колонку round если её нет (для тура/группы/стадии)
  try {
    db.prepare("ALTER TABLE matches ADD COLUMN round TEXT").run();
  } catch (error) {
    // Колонка уже существует, это нормально
  }

  // Создаём таблицу наград если её нет
  try {
    db.prepare(
      `
      CREATE TABLE IF NOT EXISTS tournament_awards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        event_name TEXT NOT NULL,
        won_bets INTEGER NOT NULL,
        awarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(event_id) REFERENCES events(id),
        UNIQUE(user_id, event_id)
      )
    `
    ).run();
  } catch (error) {
    // Таблица уже существует
  }

  // Добавляем колонки для финального матча
  try {
    db.prepare("ALTER TABLE matches ADD COLUMN is_final BOOLEAN DEFAULT 0").run();
  } catch (error) {
    // Колонка уже существует
  }

  try {
    db.prepare(
      "ALTER TABLE matches ADD COLUMN show_exact_score BOOLEAN DEFAULT 0"
    ).run();
  } catch (error) {
    // Колонка уже существует
  }

  try {
    db.prepare(
      "ALTER TABLE matches ADD COLUMN show_yellow_cards BOOLEAN DEFAULT 0"
    ).run();
  } catch (error) {
    // Колонка уже существует
  }

  try {
    db.prepare(
      "ALTER TABLE matches ADD COLUMN show_red_cards BOOLEAN DEFAULT 0"
    ).run();
  } catch (error) {
    // Колонка уже существует
  }

  try {
    db.prepare(
      "ALTER TABLE matches ADD COLUMN show_corners BOOLEAN DEFAULT 0"
    ).run();
  } catch (error) {
    // Колонка уже существует
  }

  try {
    db.prepare(
      "ALTER TABLE matches ADD COLUMN show_penalties_in_game BOOLEAN DEFAULT 0"
    ).run();
  } catch (error) {
    // Колонка уже существует
  }

  try {
    db.prepare(
      "ALTER TABLE matches ADD COLUMN show_extra_time BOOLEAN DEFAULT 0"
    ).run();
  } catch (error) {
    // Колонка уже существует
  }

  try {
    db.prepare(
      "ALTER TABLE matches ADD COLUMN show_penalties_at_end BOOLEAN DEFAULT 0"
    ).run();
  } catch (error) {
    // Колонка уже существует
  }

  // Добавляем колонки для финальных ставок в таблицу bets
  try {
    db.prepare(
      "ALTER TABLE bets ADD COLUMN is_final_bet BOOLEAN DEFAULT 0"
    ).run();
  } catch (error) {
    // Колонка уже существует
  }

  try {
    db.prepare("ALTER TABLE bets ADD COLUMN parameter_type TEXT").run();
  } catch (error) {
    // Колонка уже существует
  }

  // Добавляем колонки для счета матча
  try {
    db.prepare("ALTER TABLE matches ADD COLUMN team1_score INTEGER").run();
  } catch (error) {
    // Колонка уже существует
  }

  try {
    db.prepare("ALTER TABLE matches ADD COLUMN team2_score INTEGER").run();
  } catch (error) {
    // Колонка уже существует
  }

  // Добавляем колонки для фактических карточек в матче
  try {
    db.prepare("ALTER TABLE matches ADD COLUMN yellow_cards INTEGER").run();
  } catch (error) {
    // Колонка уже существует
  }

  try {
    db.prepare("ALTER TABLE matches ADD COLUMN red_cards INTEGER").run();
  } catch (error) {
    // Колонка уже существует
  }

  // Миграция: добавляем user_id в sent_reminders если его нет
  try {
    db.exec(`ALTER TABLE sent_reminders ADD COLUMN user_id INTEGER`);
    console.log("✅ Колонка user_id добавлена в таблицу sent_reminders");
  } catch (e) {
    // Колонка уже существует
  }

  // Миграция: добавляем image_url если её нет
  try {
    db.prepare("ALTER TABLE user_awards ADD COLUMN image_url TEXT").run();
    console.log("✅ Колонка image_url добавлена в таблицу user_awards");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем background_opacity если её нет
  try {
    db.prepare(
      "ALTER TABLE user_awards ADD COLUMN background_opacity REAL DEFAULT 1"
    ).run();
    console.log("✅ Колонка background_opacity добавлена в таблицу user_awards");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем award_color если её нет
  try {
    db.prepare(
      "ALTER TABLE user_awards ADD COLUMN award_color TEXT DEFAULT '#fbc02d'"
    ).run();
    console.log("✅ Колонка award_color добавлена в таблицу user_awards");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем award_emoji если её нет
  try {
    db.prepare(
      "ALTER TABLE user_awards ADD COLUMN award_emoji TEXT DEFAULT '🏆'"
    ).run();
    console.log("✅ Колонка award_emoji добавлена в таблицу user_awards");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем start_stage если её нет
  try {
    db.prepare("ALTER TABLE brackets ADD COLUMN start_stage TEXT DEFAULT 'round_of_16'").run();
    console.log("✅ Колонка start_stage добавлена в таблицу brackets");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем matches если её нет
  try {
    db.prepare("ALTER TABLE brackets ADD COLUMN matches TEXT").run();
    console.log("✅ Колонка matches добавлена в таблицу brackets");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем is_locked если её нет
  try {
    db.prepare("ALTER TABLE brackets ADD COLUMN is_locked INTEGER DEFAULT 0").run();
    console.log("✅ Колонка is_locked добавлена в таблицу brackets");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем lock_dates для каждой стадии (JSON)
  try {
    db.prepare("ALTER TABLE brackets ADD COLUMN lock_dates TEXT").run();
    console.log("✅ Колонка lock_dates добавлена в таблицу brackets");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем temporary_teams для слотов с двумя командами (JSON)
  try {
    db.prepare("ALTER TABLE brackets ADD COLUMN temporary_teams TEXT").run();
    console.log("✅ Колонка temporary_teams добавлена в таблицу brackets");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавление колонки only_active_tournaments если её нет
  try {
    const tableInfo = db.prepare("PRAGMA table_info(user_notification_settings)").all();
    const hasOnlyActiveTournaments = tableInfo.some(col => col.name === 'only_active_tournaments');

    if (!hasOnlyActiveTournaments) {
      console.log("🔄 Миграция: добавление колонки only_active_tournaments в user_notification_settings");
      db.exec(`ALTER TABLE user_notification_settings ADD COLUMN only_active_tournaments INTEGER DEFAULT 0`);
      console.log("✅ Миграция завершена");
    }
  } catch (error) {
    console.error("❌ Ошибка миграции user_notification_settings:", error);
  }

  // Миграция: добавление колонки three_hour_reminders если её нет
  try {
    const tableInfo = db.prepare("PRAGMA table_info(user_notification_settings)").all();
    const hasThreeHourReminders = tableInfo.some(col => col.name === 'three_hour_reminders');

    if (!hasThreeHourReminders) {
      console.log("🔄 Миграция: добавление колонки three_hour_reminders в user_notification_settings");
      db.exec(`ALTER TABLE user_notification_settings ADD COLUMN three_hour_reminders INTEGER DEFAULT 1`);
      console.log("✅ Миграция завершена");
    }
  } catch (error) {
    console.error("❌ Ошибка миграции user_notification_settings:", error);
  }

  // Миграция: таблица отслеживания инактивности пользователей по турам
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_tournament_inactivity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        inactive_rounds_count INTEGER DEFAULT 0,
        last_active_round TEXT,
        is_excluded INTEGER DEFAULT 0,
        excluded_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (event_id) REFERENCES events(id),
        UNIQUE(user_id, event_id)
      )
    `);
    console.log("✅ Таблица user_tournament_inactivity готова");
  } catch (error) {
    console.error("❌ Ошибка создания таблицы user_tournament_inactivity:", error);
  }

  // Миграция: таблица запретных имён
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS banned_names (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        is_partial INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Таблица banned_names готова");
  } catch (error) {
    console.error("❌ Ошибка создания таблицы banned_names:", error);
  }

  // Миграция: добавляем api_finished в matches (матч физически завершён по API, но очки ещё не посчитаны)
  try {
    db.prepare("ALTER TABLE matches ADD COLUMN api_finished INTEGER DEFAULT 0").run();
    console.log("✅ Колонка api_finished добавлена в таблицу matches");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Миграция: добавляем diff_goals_enabled в events (учёт разницы голов)
  // Старые турниры получат 0, новые будут создаваться с 1
  try {
    db.prepare("ALTER TABLE events ADD COLUMN diff_goals_enabled INTEGER DEFAULT 0").run();
    console.log("✅ Колонка diff_goals_enabled добавлена в таблицу events");
  } catch (e) {
    // Колонка уже существует, игнорируем
  }

  // Включаем разницу голов для текущего активного турнира (id=23, Чемпионат мира 2026)
  try {
    db.prepare("UPDATE events SET diff_goals_enabled = 1 WHERE id = 23 AND diff_goals_enabled = 0").run();
    console.log("✅ diff_goals_enabled = 1 для турнира id=23");
  } catch (e) {
    // Игнорируем
  }
}
