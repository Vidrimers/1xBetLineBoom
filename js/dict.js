/**********************
 * СЛОВАРЬ СООТВЕТСТВИЙ КОМАНД
 **********************/

const TEAM_NAME_MAP = {
  // Англия
  арсенал: "Arsenal FC",
  челси: "Chelsea FC",
  ливерпуль: "Liverpool FC",
  мансити: "Manchester City FC",
  "ман сити": "Manchester City FC",
  "манчестер сити": "Manchester City FC",
  манчестер: "Manchester United FC",
  мю: "Manchester United FC",
  "манчестер юнайтед": "Manchester United FC",
  ньюкасл: "Newcastle United FC",
  тоттенхем: "Tottenham Hotspur FC",
  тоттенхэм: "Tottenham Hotspur FC",

  // Испания
  атлетик: "Athletic Club",
  атлетико: "Club Atlético de Madrid",
  атлети: "Club Atlético de Madrid",
  барселона: "FC Barcelona",
  барса: "FC Barcelona",
  реал: "Real Madrid CF",
  "реал мадрид": "Real Madrid CF",
  вильярреал: "Villarreal CF",
  вильяреал: "Villarreal CF",

  // Германия
  бавария: "FC Bayern München",
  баиер: "Bayer 04 Leverkusen",
  байер: "Bayer 04 Leverkusen",
  боруссия: "Borussia Dortmund",
  аинтрахт: "Eintracht Frankfurt",
  лейпциг: "RB Leipzig",
  штутгарт: "VfB Stuttgart",

  // Италия
  аталанта: "Atalanta BC",
  милан: "AC Milan",
  интер: "FC Internazionale Milano",
  ювентус: "Juventus FC",
  наполи: "SSC Napoli",

  // Франция
  лилль: "LOSC Lille",
  лиль: "LOSC Lille",
  монако: "AS Monaco FC",
  марсель: "Olympique de Marseille",
  псж: "Paris Saint-Germain FC",
  пэсэжэ: "Paris Saint-Germain FC",

  // Португалия
  бенфика: "Sport Lisboa e Benfica",
  бенефика: "Sport Lisboa e Benfica",
  порту: "FC Porto",
  спортинг: "Sporting Clube de Portugal",

  // Нидерланды
  аякс: "AFC Ajax",
  фейеноорд: "Feyenoord",
  фейенорд: "Feyenoord",
  псв: "PSV",

  // Бельгия
  брюгге: "Club Brugge KV",
  брюге: "Club Brugge KV",
  брюги: "Club Brugge KV",
  юнион: "Royale Union Saint-Gilloise",

  // Турция
  галатасараи: "Galatasaray SK",

  // Греция
  олимпиакос: "PAE Olympiakos SFP",

  // Чехия
  славия: "SK Slavia Praha",

  // Норвегия
  будё: "FK Bodø/Glimt",
  буде: "FK Bodø/Glimt",
  будем: "FK Bodø/Glimt",
  глимт: "FK Bodø/Glimt",

  // Дания
  копенгаген: "FC København",
  попенгаген: "FC København",

  // Кипр
  пафос: "Paphos FC",

  // Азербайджан
  карабах: "Qarabağ Ağdam FK",

  // Казахстан
  каират: "FK Kairat",

  // Шотландия
  селтик: "Celtic FC",

  // Швейцария
  "янг бойз": "BSC Young Boys",
  зальцбург: "FC Salzburg",
  зальзбург: "FC Salzburg",

  // Сербия
  црвена: "FK Crvena Zvezda",
  "црвена звезда": "FK Crvena Zvezda",

  // Хорватия
  "динамо з": "GNK Dinamo Zagreb",

  // Украина
  шахтер: "Shakhtar Donetsk",
  шахтёр: "Shakhtar Donetsk",
};

function mapTeamName(name) {
  const raw = (name || "").toString();
  let norm = normalizeTeam_(raw)
    .replace(/\bман ?сити\b/g, "мансити")
    .replace(/\bпэ?сэ?жэ?\b/g, "псж")
    .replace(/\bтотенхем\b/g, "тоттенхем")
    .replace(/\bбенефика\b/g, "бенфика")
    .replace(/\bвильяреал\b/g, "вильярреал")
    .replace(/\bцрвена зв\b/g, "црвена")
    .replace(/\bшахт[её]р\b/g, "шахтер");
  var mapped = TEAM_NAME_MAP[norm] || raw;
  // writeLogToFile(
  //   "[mapTeamName] raw: " + raw + ", norm: " + norm + ", mapped: " + mapped
  // );
  return mapped;
}
