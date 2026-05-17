import { db } from '../database/db.js';

/**
 * Проверяет, завершён ли турнир (все матчи имеют результат),
 * и если да — создаёт новость о завершении турнира с карточкой победителя.
 * 
 * @param {number} matchId - ID матча, результат которого только что установлен
 */
export function checkAndCreateTournamentCompletionNews(matchId) {
  try {
    // Получаем информацию о матче
    const match = db.prepare(`
      SELECT m.id, m.event_id, m.is_final, m.team1_name, m.team2_name, m.winner,
             m.team1_score, m.team2_score, m.match_date,
             e.name as event_name, e.icon as event_icon
      FROM matches m
      JOIN events e ON e.id = m.event_id
      WHERE m.id = ?
    `).get(matchId);

    if (!match) return;

    // Проверяем: это финальный матч?
    if (!match.is_final) return;

    // Проверяем: все ли матчи турнира завершены (имеют winner)
    const pendingMatches = db.prepare(`
      SELECT COUNT(*) as count 
      FROM matches 
      WHERE event_id = ? AND winner IS NULL 
        AND status NOT IN ('cancelled', 'postponed', 'abandoned', 'technical_loss', 'walkover')
    `).get(match.event_id);

    if (pendingMatches.count > 0) {
      console.log(`⏳ Турнир ${match.event_name}: ещё ${pendingMatches.count} матчей без результата`);
      return;
    }

    // Проверяем: не создана ли уже новость о завершении этого турнира
    const existingNews = db.prepare(`
      SELECT id FROM news 
      WHERE type = 'tournament' 
        AND title LIKE ?
    `).get(`%${match.event_name}%Завершён%`);

    if (existingNews) {
      console.log(`ℹ️ Новость о завершении турнира "${match.event_name}" уже существует`);
      return;
    }

    // Считаем очки всех участников турнира
    const participants = db.prepare(`
      SELECT 
        u.id,
        u.username,
        u.avatar,
        COUNT(DISTINCT b.id) as total_bets,
        (SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
                       CASE 
                         WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                              ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                              sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
                         THEN 1 ELSE 0 
                       END +
                       CASE 
                         WHEN m.yellow_cards_prediction_enabled = 1 AND
                              cp.yellow_cards IS NOT NULL AND m.yellow_cards IS NOT NULL AND
                              cp.yellow_cards = m.yellow_cards
                         THEN 1 ELSE 0
                       END +
                       CASE 
                         WHEN m.red_cards_prediction_enabled = 1 AND
                              cp.red_cards IS NOT NULL AND m.red_cards IS NOT NULL AND
                              cp.red_cards = m.red_cards
                         THEN 1 ELSE 0
                       END
                  ELSE 0 
                END
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 2
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 2
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 2
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 2
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 2
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 2
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 2
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) + COALESCE((
          SELECT SUM(CASE WHEN bp.stage = 'final' THEN 3 ELSE 1 END)
          FROM bracket_predictions bp
          INNER JOIN bracket_results br ON bp.bracket_id = br.bracket_id 
            AND bp.stage = br.stage 
            AND bp.match_index = br.match_index
          INNER JOIN brackets bk ON bp.bracket_id = bk.id
          WHERE bp.user_id = u.id 
            AND bk.event_id = ?
            AND bp.predicted_winner = br.actual_winner
        ), 0)) as total_points,
        SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN 1
                  ELSE 0 
                END
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) = fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) = fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) = fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction = fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction = fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction = fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction = fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0
            END 
          ELSE 0 
        END) as won_count,
        SUM(CASE 
          WHEN (m.winner IS NOT NULL OR fpr.id IS NOT NULL) THEN 
            CASE 
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN NOT ((b.prediction = 'team1' AND m.winner = 'team1') OR
                            (b.prediction = 'team2' AND m.winner = 'team2') OR
                            (b.prediction = 'draw' AND m.winner = 'draw') OR
                            (b.prediction = m.team1_name AND m.winner = 'team1') OR
                            (b.prediction = m.team2_name AND m.winner = 'team2')) THEN 1 
                  ELSE 0 
                END
              WHEN b.is_final_bet = 1 AND fpr.id IS NOT NULL THEN
                CASE 
                  WHEN b.parameter_type = 'yellow_cards' AND CAST(b.prediction AS INTEGER) != fpr.yellow_cards THEN 1
                  WHEN b.parameter_type = 'red_cards' AND CAST(b.prediction AS INTEGER) != fpr.red_cards THEN 1
                  WHEN b.parameter_type = 'corners' AND CAST(b.prediction AS INTEGER) != fpr.corners THEN 1
                  WHEN b.parameter_type = 'exact_score' AND b.prediction != fpr.exact_score THEN 1
                  WHEN b.parameter_type = 'penalties_in_game' AND b.prediction != fpr.penalties_in_game THEN 1
                  WHEN b.parameter_type = 'extra_time' AND b.prediction != fpr.extra_time THEN 1
                  WHEN b.parameter_type = 'penalties_at_end' AND b.prediction != fpr.penalties_at_end THEN 1
                  ELSE 0
                END
              ELSE 0 
            END 
          ELSE 0 
        END) as lost_count
      FROM users u
      INNER JOIN bets b ON u.id = b.user_id
      INNER JOIN matches m ON b.match_id = m.id
      LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
      WHERE m.event_id = ?
      GROUP BY u.id, u.username, u.avatar
      HAVING COUNT(DISTINCT b.id) > 0
      ORDER BY total_points DESC
    `).all(match.event_id, match.event_id);

    if (participants.length === 0) {
      console.log(`⚠️ Нет участников в турнире ${match.event_name}`);
      return;
    }

    // Победитель — первый в списке (максимум очков)
    const winner = participants[0];
    const accuracy = winner.total_bets > 0 
      ? Math.round((winner.won_count / winner.total_bets) * 100) 
      : 0;

    // Определяем команду-победителя финала
    let finalWinnerTeam = '';
    if (match.winner === 'team1') finalWinnerTeam = match.team1_name;
    else if (match.winner === 'team2') finalWinnerTeam = match.team2_name;
    else finalWinnerTeam = 'Ничья';

    // Формируем счёт финала
    const finalScore = (match.team1_score !== null && match.team2_score !== null)
      ? `${match.team1_score}:${match.team2_score}`
      : '';

    // Берём топ-10 участников
    const top10 = participants.slice(0, 10);

    // Формируем JSON-данные для карточки (будет парситься на фронте)
    const newsData = {
      eventId: match.event_id,
      eventName: match.event_name,
      eventIcon: match.event_icon,
      finalMatch: {
        team1: match.team1_name,
        team2: match.team2_name,
        score: finalScore,
        winnerTeam: finalWinnerTeam,
        date: match.match_date
      },
      winner: {
        id: winner.id,
        username: winner.username,
        avatar: winner.avatar,
        totalPoints: winner.total_points,
        totalBets: winner.total_bets,
        wonCount: winner.won_count,
        lostCount: winner.lost_count,
        accuracy: accuracy
      },
      participants: top10.map((p, index) => ({
        position: index + 1,
        id: p.id,
        username: p.username,
        avatar: p.avatar,
        totalPoints: p.total_points
      }))
    };

    // Создаём новость
    const newsTitle = `🏆 ${match.event_name} — Завершён!`;
    const newsMessage = JSON.stringify(newsData);

    db.prepare(`
      INSERT INTO news (type, title, message)
      VALUES (?, ?, ?)
    `).run('tournament', newsTitle, newsMessage);

    console.log(`🏆 Создана новость о завершении турнира "${match.event_name}". Победитель: ${winner.username} (${winner.total_points} очков)`);

    // Обновляем статус турнира на "completed"
    db.prepare(`UPDATE events SET status = 'completed' WHERE id = ?`).run(match.event_id);
    console.log(`✅ Статус турнира "${match.event_name}" обновлён на "completed"`);

  } catch (error) {
    console.error('❌ Ошибка создания новости о завершении турнира:', error);
  }
}
