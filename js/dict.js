/**********************
 * СЛОВАРЬ СООТВЕТСТВИЙ КОМАНД
 **********************/

const TEAM_NAME_MAP = {
  // ===== PREMIER LEAGUE (АНГЛИЯ) =====
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

  // ===== LA LIGA (ИСПАНИЯ) =====
  атлетик: "Athletic Club",
  атлетико: "Club Atlético de Madrid",
  атлети: "Club Atlético de Madrid",
  барселона: "FC Barcelona",
  барса: "FC Barcelona",
  реал: "Real Madrid CF",
  "реал мадрид": "Real Madrid CF",
  вильярреал: "Villarreal CF",
  вильяреал: "Villarreal CF",

  // ===== BUNDESLIGA (ГЕРМАНИЯ) =====
  бавария: "FC Bayern München",
  баиер: "Bayer 04 Leverkusen",
  байер: "Bayer 04 Leverkusen",
  боруссия: "Borussia Dortmund",
  аинтрахт: "Eintracht Frankfurt",
  лейпциг: "RB Leipzig",
  штутгарт: "VfB Stuttgart",

  // ===== LIGUE 1 (ФРАНЦИЯ) =====
  лилль: "LOSC Lille",
  лиль: "LOSC Lille",
  монако: "AS Monaco FC",
  марсель: "Olympique de Marseille",
  псж: "Paris Saint-Germain FC",
  пэсэжэ: "Paris Saint-Germain FC",

  // ===== PRIMEIRA LIGA (ПОРТУГАЛИЯ) =====
  бенфика: "Sport Lisboa e Benfica",
  бенефика: "Sport Lisboa e Benfica",
  порту: "FC Porto",
  спортинг: "Sporting Clube de Portugal",

  // ===== EREDIVISIE (НИДЕРЛАНДЫ) =====
  аякс: "AFC Ajax",
  фейеноорд: "Feyenoord",
  фейенорд: "Feyenoord",
  псв: "PSV",

  // ===== PRO LEAGUE A (БЕЛЬГИЯ) =====
  брюгге: "Club Brugge KV",
  брюге: "Club Brugge KV",
  брюги: "Club Brugge KV",
  юнион: "Royale Union Saint-Gilloise",

  // ===== SÜPER LIG (ТУРЦИЯ) =====
  галатасараи: "Galatasaray SK",

  // ===== SUPER LEAGUE (ГРЕЦИЯ) =====
  олимпиакос: "PAE Olympiakos SFP",

  // ===== CZECH FIRST LEAGUE (ЧЕХИЯ) =====
  славия: "SK Slavia Praha",

  // ===== ELITESERIEN (НОРВЕГИЯ) =====
  будё: "FK Bodø/Glimt",
  буде: "FK Bodø/Glimt",
  будем: "FK Bodø/Glimt",
  глимт: "FK Bodø/Glimt",

  // ===== SUPERLIGAEN (ДАНИЯ) =====
  копенгаген: "FC København",
  попенгаген: "FC København",

  // ===== CYPRIOT FIRST DIVISION (КИПР) =====
  пафос: "Paphos FC",

  // ===== PREMIER LEAGUE (АЗЕРБАЙДЖАН) =====
  карабах: "Qarabağ Ağdam FK",

  // ===== PREMIER LEAGUE (КАЗАХСТАН) =====
  каират: "FK Kairat",

  // ===== SCOTTISH PREMIERSHIP (ШОТЛАНДИЯ) =====
  селтик: "Celtic FC",

  // ===== SUPER LEAGUE (ШВЕЙЦАРИЯ) =====
  "янг бойз": "BSC Young Boys",
  зальцбург: "FC Salzburg",
  зальзбург: "FC Salzburg",

  // ===== SUPER LIGA (СЕРБИЯ) =====
  црвена: "FK Crvena Zvezda",
  "црвена звезда": "FK Crvena Zvezda",

  // ===== FIRST LEAGUE (ХОРВАТИЯ) =====
  "динамо з": "GNK Dinamo Zagreb",

  // ===== PREMIER LEAGUE (УКРАИНА) =====
  шахтер: "Shakhtar Donetsk",
  шахтёр: "Shakhtar Donetsk",

  // ===== SERIE A (ИТАЛИЯ) =====
  аталанта: "Atalanta BC",
  милан: "AC Milan",
  интер: "FC Internazionale Milano",
  ювентус: "Juventus FC",
  наполи: "SSC Napoli",
  лацио: "SS Lazio",
  рома: "AS Roma",
  сапрента: "US Salernitana 1919",
  фиорентина: "ACF Fiorentina",
  сампдория: "UC Sampdoria",
  удинезе: "Udinese Calcio",
  верона: "Hellas Verona FC",
  эмполи: "Empoli FC",
  сассуоло: "US Sassuolo Calcio",
  торино: "Torino FC",
  специя: "Spezia Calcio",
  кремонезе: "US Cremonese",
  лечче: "US Lecce",
  монца: "AC Monza",
  павия: "AC Pavia",
  перуджа: "AC Perugia Calcio",
  реггиана: "AC Reggiana 1919",
  триестина: "US Triestina Calcio 1918",
  виченца: "LR Vicenza",
  пиза: "AC Pisa 1909",
  комо: "Como 1907",
  кальяри: "Cagliari Calcio",
  парма: "Parma Calcio 1913",

  // ===== WORLD CUP 2026 =====
  // NORTE Y AMÉRICA CENTRAL
  канада: "Canada",
  мексика: "Mexico",
  сша: "United States",
  США: "United States",
  америка: "United States",

  // SUDAMÉRICA
  аргентина: "Argentina",
  боливия: "Bolivia",
  бразилия: "Brazil",
  чили: "Chile",
  колумбия: "Colombia",
  эквадор: "Ecuador",
  парагвай: "Paraguay",
  перу: "Peru",
  уругвай: "Uruguay",
  венесуэла: "Venezuela",

  // EUROPA
  албания: "Albania",
  андорра: "Andorra",
  австрия: "Austria",
  беларусь: "Belarus",
  бельгия: "Belgium",
  босния: "Bosnia and Herzegovina",
  болгария: "Bulgaria",
  хорватия: "Croatia",
  кипр: "Cyprus",
  чехия: "Czech Republic",
  дания: "Denmark",
  англия: "England",
  эстония: "Estonia",
  финляндия: "Finland",
  франция: "France",
  грузия: "Georgia",
  германия: "Germany",
  греция: "Greece",
  венгрия: "Hungary",
  исландия: "Iceland",
  ирландия: "Republic of Ireland",
  израиль: "Israel",
  италия: "Italy",
  косово: "Kosovo",
  латвия: "Latvia",
  литва: "Lithuania",
  люксембург: "Luxembourg",
  мальта: "Malta",
  молдавия: "Moldova",
  монако: "Monaco",
  черногория: "Montenegro",
  нидерланды: "Netherlands",
  "северная ирландия": "Northern Ireland",
  норвегия: "Norway",
  польша: "Poland",
  португалия: "Portugal",
  румыния: "Romania",
  россия: "Russia",
  "сан марино": "San Marino",
  сербия: "Serbia",
  словакия: "Slovakia",
  словения: "Slovenia",
  испания: "Spain",
  швеция: "Sweden",
  швейцария: "Switzerland",
  украина: "Ukraine",
  уэльс: "Wales",

  // ASIA
  австралия: "Australia",
  афганистан: "Afghanistan",
  азербайджан: "Azerbaijan",
  бахрейн: "Bahrain",
  бангладеш: "Bangladesh",
  бутан: "Bhutan",
  бруней: "Brunei",
  камбоджа: "Cambodia",
  китай: "China",
  гонконг: "Hong Kong",
  индия: "India",
  индонезия: "Indonesia",
  иран: "Iran",
  ирак: "Iraq",
  израиль: "Israel",
  япония: "Japan",
  казахстан: "Kazakhstan",
  кувейт: "Kuwait",
  киргизия: "Kyrgyzstan",
  лаос: "Laos",
  ливан: "Lebanon",
  макао: "Macau",
  малайзия: "Malaysia",
  мальдивы: "Maldives",
  монголия: "Mongolia",
  мьянма: "Myanmar",
  непал: "Nepal",
  оман: "Oman",
  пакистан: "Pakistan",
  филиппины: "Philippines",
  катар: "Qatar",
  "саудовская аравия": "Saudi Arabia",
  сингапур: "Singapore",
  "южная корея": "South Korea",
  таджикистан: "Tajikistan",
  таиланд: "Thailand",
  "восточный тимор": "East Timor",
  туркменистан: "Turkmenistan",
  "объединенные арабские эмираты": "United Arab Emirates",
  узбекистан: "Uzbekistan",
  вьетнам: "Vietnam",
  йемен: "Yemen",

  // AFRICA
  алжир: "Algeria",
  ангола: "Angola",
  бенин: "Benin",
  ботсвана: "Botswana",
  "буркина фасо": "Burkina Faso",
  бурунди: "Burundi",
  камерун: "Cameroon",
  "кабо верде": "Cape Verde",
  "центральноафриканская республика": "Central African Republic",
  чад: "Chad",
  "коморские острова": "Comoros",
  конго: "Democratic Republic of the Congo",
  котдивуар: "Ivory Coast",
  джибути: "Djibouti",
  египет: "Egypt",
  "экваториальная гвинея": "Equatorial Guinea",
  эритрея: "Eritrea",
  эфиопия: "Ethiopia",
  габон: "Gabon",
  гамбия: "Gambia",
  гана: "Ghana",
  гвинея: "Guinea",
  "гвинея бисау": "Guinea-Bissau",
  кения: "Kenya",
  лесото: "Lesotho",
  либерия: "Liberia",
  ливия: "Libya",
  madagascar: "Madagascar",
  малави: "Malawi",
  мали: "Mali",
  mauritius: "Mauritius",
  марокко: "Morocco",
  мозамбик: "Mozambique",
  намибия: "Namibia",
  нигер: "Niger",
  нигерия: "Nigeria",
  руанда: "Rwanda",
  "сан томе и принсипи": "São Tomé and Príncipe",
  сенегал: "Senegal",
  "сейшельские острова": "Seychelles",
  "sierra leone": "Sierra Leone",
  сомали: "Somalia",
  "южная африка": "South Africa",
  "южный судан": "South Sudan",
  судан: "Sudan",
  свазиленд: "Eswatini",
  танзания: "Tanzania",
  того: "Togo",
  тунис: "Tunisia",
  уганда: "Uganda",
  замбия: "Zambia",
  зимбабве: "Zimbabwe",

  // OCEANIA
  фиджи: "Fiji",
  кирибати: "Kiribati",
  маршаллы: "Marshall Islands",
  микронезия: "Micronesia",
  науру: "Nauru",
  "новая зеландия": "New Zealand",
  палау: "Palau",
  "папуа новая гвинея": "Papua New Guinea",
  "соломоновы острова": "Solomon Islands",
  тонга: "Tonga",
  тувалу: "Tuvalu",
  вануату: "Vanuatu",
  самоа: "Samoa",
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
  return mapped;
}

function removeDiacritics_(s) {
  try {
    return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (e) {
    return s || "";
  }
}

function fixSpaces_(s) {
  return (s || "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTeam_(s) {
  return fixSpaces_(removeDiacritics_(s))
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9\u0400-\u04FF\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
