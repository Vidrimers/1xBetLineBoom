import { db } from '../database/db.js';

/**
 * Получает участников турнира с правильным подсчетом очков
 * Использует тот же SQL запрос что и в events.js
 */
export function getTournamentParticipantsWithPoints(eventId) {
  try {
    const participants = db.prepare(`
      SELECT 
        u.id,
        u.username,
        u.avatar,
        u.show_bets,
        COUNT(DISTINCT b.id) as event_bets,
        (SUM(CASE 
          WHEN m.winner IS NOT NULL OR fpr.id IS NOT NULL THEN 
            CASE 
              -- Обычные ставки (не финальные параметры)
              WHEN b.is_final_bet = 0 AND m.winner IS NOT NULL THEN
                CASE 
                  WHEN (b.prediction = 'team1' AND m.winner = 'team1') OR
                       (b.prediction = 'team2' AND m.winner = 'team2') OR
                       (b.prediction = 'draw' AND m.winner = 'draw') OR
                       (b.prediction = m.team1_name AND m.winner = 'team1') OR
                       (b.prediction = m.team2_name AND m.winner = 'team2') THEN
                       -- Базовое очко за угаданный результат (3 за финал, 1 за обычный матч)
                       CASE WHEN m.is_final = 1 THEN 3 ELSE 1 END +
                       -- Дополнительное очко за угаданный счет
                       CASE 
                         WHEN sp.score_team1 IS NOT NULL AND sp.score_team2 IS NOT NULL AND
                              ms.score_team1 IS NOT NULL AND ms.score_team2 IS NOT NULL AND
                              sp.score_team1 = ms.score_team1 AND sp.score_team2 = ms.score_team2 
                         THEN 1 
                         ELSE 0 
                       END +
                       -- Дополнительное очко за угаданные желтые карточки
                       CASE 
                         WHEN m.yellow_cards_prediction_enabled = 1 AND
                              cp.yellow_cards IS NOT NULL AND m.yellow_cards IS NOT NULL AND
                              cp.yellow_cards = m.yellow_cards
                         THEN 1
                         ELSE 0
                       END +
                       -- Дополнительное очко за угаданные красные карточки
                       CASE 
                         WHEN m.red_cards_prediction_enabled = 1 AND
                              cp.red_cards IS NOT NULL AND m.red_cards IS NOT NULL AND
                              cp.red_cards = m.red_cards
                         THEN 1
                         ELSE 0
                       END
                  ELSE 0 
                END
              -- Финальные параметры (yellow_cards, red_cards, corners и т.д.)
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
        ), 0)) as event_won,
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
        END) as event_lost
      FROM users u
      INNER JOIN bets b ON u.id = b.user_id
      INNER JOIN matches m ON b.match_id = m.id
      LEFT JOIN final_parameters_results fpr ON b.match_id = fpr.match_id AND b.is_final_bet = 1
      LEFT JOIN score_predictions sp ON b.user_id = sp.user_id AND b.match_id = sp.match_id
      LEFT JOIN match_scores ms ON b.match_id = ms.match_id
      LEFT JOIN cards_predictions cp ON b.user_id = cp.user_id AND b.match_id = cp.match_id
      WHERE m.event_id = ?
      GROUP BY u.id, u.username, u.avatar, u.show_bets
      HAVING COUNT(DISTINCT b.id) > 0
      ORDER BY event_won DESC, event_lost ASC
    `).all(eventId, eventId);

    return participants;
  } catch (error) {
    console.error('❌ Ошибка получения участников турнира:', error);
    return [];
  }
}

/**
 * Получает статистику конкретного пользователя в турнире
 */
export function getUserStatsInTournament(eventId, username) {
  try {
    const participants = getTournamentParticipantsWithPoints(eventId);
    const userStats = participants.find(p => p.username.toLowerCase() === username.toLowerCase());
    
    if (userStats) {
      const position = participants.findIndex(p => p.username.toLowerCase() === username.toLowerCase()) + 1;
      return {
        ...userStats,
        position
      };
    }
    
    return null;
  } catch (error) {
    console.error('❌ Ошибка получения статистики пользователя:', error);
    return null;
  }
}