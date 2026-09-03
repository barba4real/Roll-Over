/**
 * Team Name Alias Database
 *
 * Maps various team name variations to a single canonical (English-friendly) name.
 * Used for dedup when merging fixtures from multiple providers.
 *
 * Each entry: canonical name → array of known aliases (lowercase).
 * When a fixture arrives, we check if the team name matches any alias,
 * and if so, use the canonical name instead.
 *
 * This file can grow over time as new mismatches are discovered.
 */

// ─── Alias Map ───────────────────────────────────────────────────────────────

const TEAM_ALIASES: Record<string, string[]> = {
  // ═══ England ═══
  'Arsenal': ['arsenal fc', 'arsenal'],
  'Aston Villa': ['aston villa fc', 'aston villa'],
  'Bournemouth': ['afc bournemouth', 'bournemouth', 'bournemouth fc'],
  'Brentford': ['brentford fc', 'brentford'],
  'Brighton': ['brighton & hove albion', 'brighton and hove albion', 'brighton & hove albion fc', 'brighton hove albion'],
  'Chelsea': ['chelsea fc', 'chelsea'],
  'Crystal Palace': ['crystal palace fc', 'crystal palace'],
  'Everton': ['everton fc', 'everton'],
  'Fulham': ['fulham fc', 'fulham'],
  'Ipswich Town': ['ipswich town fc', 'ipswich town', 'ipswich'],
  'Leicester City': ['leicester city fc', 'leicester city', 'leicester'],
  'Liverpool': ['liverpool fc', 'liverpool'],
  'Manchester City': ['manchester city fc', 'manchester city', 'man city'],
  'Manchester United': ['manchester united fc', 'manchester united', 'man united', 'man utd'],
  'Newcastle United': ['newcastle united fc', 'newcastle united', 'newcastle utd', 'newcastle'],
  'Nottingham Forest': ['nottingham forest fc', 'nottingham forest', 'nott forest', 'nottm forest'],
  'Southampton': ['southampton fc', 'southampton'],
  'Tottenham': ['tottenham hotspur fc', 'tottenham hotspur', 'tottenham', 'spurs'],
  'West Ham': ['west ham united fc', 'west ham united', 'west ham'],
  'Wolverhampton': ['wolverhampton wanderers fc', 'wolverhampton wanderers', 'wolverhampton', 'wolves'],

  // ═══ Spain ═══
  'Atletico Madrid': ['atletico de madrid', 'club atletico de madrid', 'atletico madrid', 'atl. madrid', 'atl madrid'],
  'Barcelona': ['fc barcelona', 'barcelona', 'barca'],
  'Real Madrid': ['real madrid cf', 'real madrid'],
  'Real Sociedad': ['real sociedad', 'real sociedad de futbol'],
  'Real Betis': ['real betis balompie', 'real betis', 'betis'],
  'Athletic Bilbao': ['athletic club', 'athletic bilbao', 'ath bilbao', 'athletic club bilbao'],
  'Villarreal': ['villarreal cf', 'villarreal'],
  'Sevilla': ['sevilla fc', 'sevilla'],
  'Valencia': ['valencia cf', 'valencia'],
  'Celta Vigo': ['rc celta de vigo', 'celta de vigo', 'celta vigo'],
  'Espanyol': ['rcd espanyol', 'espanyol', 'rcd espanyol de barcelona'],
  'Getafe': ['getafe cf', 'getafe'],
  'Alaves': ['deportivo alaves', 'alaves', 'cd alaves'],
  'Osasuna': ['ca osasuna', 'osasuna', 'club atletico osasuna'],
  'Mallorca': ['rcd mallorca', 'mallorca', 'real mallorca'],
  'Racing Santander': ['real racing club de santander', 'racing santander', 'racing de santander', 'real racing club'],
  'Valladolid': ['real valladolid', 'valladolid', 'real valladolid cf'],
  'Las Palmas': ['ud las palmas', 'las palmas'],
  'Leganes': ['cd leganes', 'leganes'],
  'Girona': ['girona fc', 'girona'],
  'Rayo Vallecano': ['rayo vallecano de madrid', 'rayo vallecano'],

  // ═══ Germany ═══
  'Bayern Munich': ['fc bayern munchen', 'bayern munchen', 'bayern munich', 'fc bayern', 'bayern'],
  'Borussia Dortmund': ['borussia dortmund', 'bor. dortmund', 'bvb', 'dortmund'],
  'Bayer Leverkusen': ['bayer 04 leverkusen', 'bayer leverkusen', 'leverkusen'],
  'RB Leipzig': ['rb leipzig', 'rasenballsport leipzig', 'leipzig'],
  'Eintracht Frankfurt': ['eintracht frankfurt', 'sg eintracht frankfurt', 'frankfurt'],
  'Borussia Monchengladbach': ['borussia monchengladbach', "b. monchengladbach", "m'gladbach", 'gladbach', 'bor. monchengladbach'],
  'VfB Stuttgart': ['vfb stuttgart', 'stuttgart'],
  'VfL Wolfsburg': ['vfl wolfsburg', 'wolfsburg'],
  'SC Freiburg': ['sc freiburg', 'freiburg', 'sport-club freiburg'],
  'TSG Hoffenheim': ['tsg 1899 hoffenheim', 'tsg hoffenheim', 'hoffenheim'],
  'Union Berlin': ['1. fc union berlin', 'union berlin', 'fc union berlin'],
  'Werder Bremen': ['sv werder bremen', 'werder bremen', 'bremen'],
  'FC Augsburg': ['fc augsburg', 'augsburg'],
  'Mainz 05': ['1. fsv mainz 05', 'mainz 05', 'mainz'],
  'Heidenheim': ['1. fc heidenheim 1846', 'fc heidenheim', 'heidenheim'],
  'FC Koln': ['1. fc koln', 'fc koln', 'koln', 'cologne'],
  'Hertha Berlin': ['hertha bsc', 'hertha berlin', 'hertha bsc berlin'],

  // ═══ Italy ═══
  'AC Milan': ['ac milan', 'milan', 'associazione calcio milan'],
  'Inter Milan': ['fc internazionale milano', 'inter', 'internazionale', 'inter milan'],
  'Juventus': ['juventus fc', 'juventus'],
  'Napoli': ['ssc napoli', 'napoli'],
  'Roma': ['as roma', 'roma'],
  'Lazio': ['ss lazio', 'lazio'],
  'Fiorentina': ['acf fiorentina', 'fiorentina'],
  'Atalanta': ['atalanta bc', 'atalanta'],
  'Torino': ['torino fc', 'torino'],
  'Bologna': ['bologna fc 1909', 'bologna fc', 'bologna'],
  'Udinese': ['udinese calcio', 'udinese'],
  'Sassuolo': ['us sassuolo calcio', 'sassuolo', 'us sassuolo'],
  'Empoli': ['empoli fc', 'empoli'],
  'Cagliari': ['cagliari calcio', 'cagliari'],
  'Genoa': ['genoa cfc', 'genoa'],
  'Lecce': ['us lecce', 'lecce'],
  'Monza': ['ac monza', 'monza'],
  'Verona': ['hellas verona fc', 'hellas verona', 'verona'],
  'Como': ['como 1907', 'como'],
  'Venezia': ['venezia fc', 'venezia'],
  'Parma': ['parma calcio 1913', 'parma'],
  'Cremonese': ['us cremonese', 'cremonese'],
  'Catanzaro': ['us catanzaro 1929', 'catanzaro'],

  // ═══ France ═══
  'Paris Saint-Germain': ['paris saint-germain', 'paris saint germain', 'paris sg', 'psg'],
  'Marseille': ['olympique de marseille', 'olympique marseille', 'om', 'marseille'],
  'Lyon': ['olympique lyonnais', 'olympique lyon', 'lyon', 'ol'],
  'Monaco': ['as monaco', 'monaco', 'as monaco fc'],
  'Lille': ['losc lille', 'lille osc', 'lille'],
  'Nice': ['ogc nice', 'nice'],
  'Lens': ['rc lens', 'lens', 'racing club de lens'],
  'Rennes': ['stade rennais fc', 'stade rennais', 'rennes'],
  'Strasbourg': ['rc strasbourg alsace', 'rc strasbourg', 'strasbourg'],
  'Nantes': ['fc nantes', 'nantes'],
  'Montpellier': ['montpellier hsc', 'montpellier'],
  'Toulouse': ['toulouse fc', 'toulouse'],
  'Brest': ['stade brestois 29', 'stade brestois', 'brest'],
  'Reims': ['stade de reims', 'reims'],
  'Le Havre': ['le havre ac', 'le havre'],
  'Saint-Etienne': ['as saint-etienne', 'saint-etienne', 'st etienne'],
  'Angers': ['angers sco', 'angers'],

  // ═══ Netherlands ═══
  'Ajax': ['afc ajax', 'ajax amsterdam', 'ajax'],
  'PSV': ['psv eindhoven', 'psv'],
  'Feyenoord': ['feyenoord rotterdam', 'feyenoord'],
  'AZ Alkmaar': ['az alkmaar', 'az'],

  // ═══ Portugal ═══
  'Benfica': ['sl benfica', 'benfica', 'sport lisboa e benfica'],
  'Porto': ['fc porto', 'porto'],
  'Sporting CP': ['sporting cp', 'sporting clube de portugal', 'sporting lisbon', 'sporting'],
  'Braga': ['sc braga', 'sporting braga', 'braga'],

  // ═══ Scotland ═══
  'Celtic': ['celtic fc', 'celtic'],
  'Rangers': ['rangers fc', 'rangers', 'glasgow rangers'],

  // ═══ Turkey ═══
  'Galatasaray': ['galatasaray sk', 'galatasaray', 'galatasaray a.s.'],
  'Fenerbahce': ['fenerbahce sk', 'fenerbahce'],
  'Besiktas': ['besiktas jk', 'besiktas'],
  'Trabzonspor': ['trabzonspor', 'trabzonspor a.s.'],
  'Istanbul Basaksehir': ['istanbul basaksehir fk', 'basaksehir', 'istanbul basaksehir'],
  'Antalyaspor': ['antalyaspor', 'fraport tav antalyaspor'],
  'Konyaspor': ['konyaspor', 'ittifak holding konyaspor'],
  'Sivasspor': ['sivasspor', 'demir grup sivasspor'],
  'Kasimpasa': ['kasimpasa sk', 'kasimpasa'],
  'Alanyaspor': ['alanyaspor', 'corendon alanyaspor'],

  // ═══ Belgium ═══
  'Club Brugge': ['club brugge kv', 'club brugge', 'club bruges'],
  'Anderlecht': ['rsc anderlecht', 'anderlecht'],
  'Gent': ['kaa gent', 'gent', 'kaa gent'],
  'Antwerp': ['royal antwerp fc', 'antwerp', 'royal antwerp'],
  'Union Saint-Gilloise': ['royale union saint-gilloise', 'union saint-gilloise', 'union sg'],
  'Standard Liege': ['standard de liege', 'standard liege', 'standard'],
  'Genk': ['krc genk', 'genk', 'racing genk'],
  'Cercle Brugge': ['cercle brugge ksv', 'cercle brugge'],
  'Mechelen': ['kv mechelen', 'mechelen'],
  'Charleroi': ['sporting charleroi', 'charleroi'],

  // ═══ Austria ═══
  'Red Bull Salzburg': ['fc red bull salzburg', 'rb salzburg', 'red bull salzburg', 'salzburg'],
  'Rapid Wien': ['sk rapid wien', 'rapid wien', 'rapid vienna'],
  'Austria Wien': ['fk austria wien', 'austria wien', 'austria vienna'],
  'Sturm Graz': ['sk sturm graz', 'sturm graz'],
  'LASK': ['lask linz', 'lask'],
  'Wolfsberger AC': ['wolfsberger ac', 'wolfsberger', 'wac'],

  // ═══ Greece ═══
  'Olympiacos': ['olympiacos fc', 'olympiacos', 'olympiakos'],
  'Panathinaikos': ['panathinaikos fc', 'panathinaikos'],
  'AEK Athens': ['aek athens fc', 'aek athens', 'aek'],
  'PAOK': ['paok fc', 'paok thessaloniki', 'paok'],
  'Aris': ['aris thessaloniki fc', 'aris', 'aris thessaloniki'],

  // ═══ Scandinavia ═══
  'Copenhagen': ['fc copenhagen', 'fc kobenhavn', 'copenhagen'],
  'Midtjylland': ['fc midtjylland', 'midtjylland'],
  'Brondby': ['brondby if', 'brondby'],
  'Nordsjaelland': ['fc nordsjaelland', 'nordsjaelland'],
  'Malmo FF': ['malmo ff', 'malmo'],
  'AIK': ['aik fotboll', 'aik stockholm', 'aik'],
  'Djurgarden': ['djurgardens if', 'djurgarden'],
  'Hammarby': ['hammarby if', 'hammarby'],
  'Rosenborg': ['rosenborg bk', 'rosenborg'],
  'Bodo/Glimt': ['fk bodo/glimt', 'bodo glimt', 'bodo/glimt', 'bodoe/glimt'],
  'Molde': ['molde fk', 'molde'],

  // ═══ MLS (USA) ═══
  'LA Galaxy': ['la galaxy', 'los angeles galaxy'],
  'LAFC': ['los angeles fc', 'lafc'],
  'Inter Miami': ['inter miami cf', 'inter miami'],
  'New York City FC': ['new york city fc', 'nycfc', 'nyc fc'],
  'New York Red Bulls': ['new york red bulls', 'ny red bulls'],
  'Atlanta United': ['atlanta united fc', 'atlanta united'],
  'Seattle Sounders': ['seattle sounders fc', 'seattle sounders'],
  'Portland Timbers': ['portland timbers', 'portland'],
  'Nashville SC': ['nashville sc', 'nashville'],
  'Philadelphia Union': ['philadelphia union', 'philly union'],
  'Columbus Crew': ['columbus crew', 'columbus crew sc'],
  'FC Cincinnati': ['fc cincinnati', 'cincinnati'],
  'DC United': ['dc united', 'd.c. united'],
  'Charlotte FC': ['charlotte fc', 'charlotte'],
  'Austin FC': ['austin fc', 'austin'],
  'CF Montreal': ['cf montreal', 'cf montreal', 'montreal'],
  'Toronto FC': ['toronto fc', 'toronto'],
  'Vancouver Whitecaps': ['vancouver whitecaps fc', 'vancouver whitecaps', 'vancouver'],
  'Minnesota United': ['minnesota united fc', 'minnesota united', 'minnesota'],
  'Sporting KC': ['sporting kansas city', 'sporting kc'],
  'FC Dallas': ['fc dallas', 'dallas'],
  'Houston Dynamo': ['houston dynamo fc', 'houston dynamo'],
  'Real Salt Lake': ['real salt lake', 'rsl'],
  'Colorado Rapids': ['colorado rapids', 'colorado'],
  'San Jose Earthquakes': ['san jose earthquakes', 'san jose'],
  'St. Louis City SC': ['st. louis city sc', 'st louis city', 'st. louis city'],

  // ═══ Brazil ═══
  'Flamengo': ['cr flamengo', 'flamengo', 'clube de regatas do flamengo'],
  'Palmeiras': ['se palmeiras', 'palmeiras', 'sociedade esportiva palmeiras'],
  'Corinthians': ['sc corinthians', 'corinthians', 'sport club corinthians paulista'],
  'Sao Paulo': ['sao paulo fc', 'sao paulo'],
  'Fluminense': ['fluminense fc', 'fluminense'],
  'Internacional': ['sc internacional', 'internacional', 'inter de porto alegre'],
  'Atletico Mineiro': ['clube atletico mineiro', 'atletico mineiro', 'atletico-mg'],
  'Botafogo': ['botafogo fr', 'botafogo', 'botafogo de futebol e regatas'],
  'Gremio': ['gremio fbpa', 'gremio', 'gremio foot-ball porto alegrense'],
  'Santos': ['santos fc', 'santos'],
  'Vasco da Gama': ['cr vasco da gama', 'vasco da gama', 'vasco'],
  'Cruzeiro': ['cruzeiro ec', 'cruzeiro', 'cruzeiro esporte clube'],
  'Bahia': ['ec bahia', 'bahia', 'esporte clube bahia'],
  'Fortaleza': ['fortaleza ec', 'fortaleza', 'fortaleza esporte clube'],
  'Athletico Paranaense': ['club athletico paranaense', 'athletico paranaense', 'athletico-pr', 'atletico paranaense'],
  'Bragantino': ['red bull bragantino', 'bragantino', 'rb bragantino'],
  'Cuiaba': ['cuiaba ec', 'cuiaba', 'cuiaba esporte clube'],
  'Goias': ['goias ec', 'goias', 'goias esporte clube'],
  'Coritiba': ['coritiba fbc', 'coritiba', 'coritiba foot ball club'],
  'America Mineiro': ['america mineiro', 'america-mg', 'america futebol clube'],

  // ═══ Argentina ═══
  'Boca Juniors': ['ca boca juniors', 'boca juniors', 'boca'],
  'River Plate': ['ca river plate', 'river plate', 'river'],
  'Racing Club': ['racing club', 'racing club de avellaneda', 'racing'],
  'Independiente': ['ca independiente', 'independiente'],
  'San Lorenzo': ['ca san lorenzo', 'san lorenzo', 'san lorenzo de almagro'],
  'Velez Sarsfield': ['club atletico velez sarsfield', 'velez sarsfield', 'velez'],
  'Estudiantes': ['estudiantes de la plata', 'estudiantes'],
  'Lanus': ['ca lanus', 'lanus', 'club atletico lanus'],
  'Talleres': ['talleres de cordoba', 'talleres'],
  'Godoy Cruz': ['godoy cruz antonio tomba', 'godoy cruz'],
  'Argentinos Juniors': ['argentinos juniors', 'aa argentinos juniors'],
  'Huracan': ['ca huracan', 'huracan'],
  'Rosario Central': ['rosario central', 'ca rosario central'],
  'Newells Old Boys': ["newell's old boys", 'newells old boys', "newell's"],
  'Defensa y Justicia': ['defensa y justicia', 'club social y deportivo defensa y justicia'],
  'Banfield': ['ca banfield', 'banfield'],
  'Tigre': ['ca tigre', 'tigre', 'club atletico tigre'],
  'Union Santa Fe': ['club atletico union', 'union santa fe', 'union de santa fe'],
  'Colon': ['ca colon', 'colon de santa fe', 'colon'],

  // ═══ Mexico ═══
  'Club America': ['club america', 'america', 'club de futbol america'],
  'Guadalajara': ['cd guadalajara', 'guadalajara', 'chivas'],
  'Cruz Azul': ['cruz azul', 'cd cruz azul'],
  'UNAM Pumas': ['club universidad nacional', 'unam pumas', 'pumas unam', 'pumas'],
  'Monterrey': ['cf monterrey', 'monterrey', 'rayados'],
  'Tigres UANL': ['tigres uanl', 'tigres', 'club de futbol tigres de la universidad autonoma de nuevo leon'],
  'Santos Laguna': ['santos laguna', 'club santos laguna'],
  'Leon': ['club leon', 'leon', 'club leon fc'],
  'Toluca': ['deportivo toluca', 'toluca', 'deportivo toluca fc'],
  'Pachuca': ['cf pachuca', 'pachuca'],
  'Atlas': ['atlas fc', 'atlas', 'club atlas'],
  'Tijuana': ['club tijuana', 'tijuana', 'xolos'],
  'Puebla': ['club puebla', 'puebla'],
  'Necaxa': ['club necaxa', 'necaxa'],
  'Queretaro': ['queretaro fc', 'queretaro', 'club queretaro'],
  'Mazatlan': ['mazatlan fc', 'mazatlan'],
  'San Luis': ['atletico de san luis', 'san luis', 'atletico san luis'],
  'Juarez': ['fc juarez', 'juarez', 'bravos de juarez'],

  // ═══ Saudi Arabia ═══
  'Al Hilal': ['al-hilal saudi fc', 'al hilal', 'al-hilal'],
  'Al Nassr': ['al-nassr fc', 'al nassr', 'al-nassr'],
  'Al Ittihad': ['al-ittihad club', 'al ittihad', 'al-ittihad'],
  'Al Ahli': ['al-ahli saudi fc', 'al ahli', 'al-ahli'],

  // ═══ Japan ═══
  'Vissel Kobe': ['vissel kobe', 'kobe'],
  'Yokohama F. Marinos': ['yokohama f. marinos', 'yokohama f marinos', 'yokohama marinos'],
  'Urawa Red Diamonds': ['urawa red diamonds', 'urawa reds', 'urawa'],
  'Kawasaki Frontale': ['kawasaki frontale', 'kawasaki'],
  'Kashima Antlers': ['kashima antlers', 'kashima'],

  // ═══ Australia ═══
  'Melbourne Victory': ['melbourne victory fc', 'melbourne victory'],
  'Sydney FC': ['sydney fc', 'sydney'],
  'Western Sydney': ['western sydney wanderers fc', 'western sydney wanderers', 'ws wanderers'],
  'Melbourne City': ['melbourne city fc', 'melbourne city'],
  'Central Coast Mariners': ['central coast mariners fc', 'central coast mariners', 'cc mariners'],

  // ═══ South Africa ═══
  'Kaizer Chiefs': ['kaizer chiefs fc', 'kaizer chiefs'],
  'Orlando Pirates': ['orlando pirates fc', 'orlando pirates'],
  'Mamelodi Sundowns': ['mamelodi sundowns fc', 'mamelodi sundowns', 'sundowns'],

  // ═══ England — EFL Championship / League One (common lower-league sides) ═══
  'Wrexham': ['wrexham afc', 'wrexham fc', 'wrexham'],
  'Birmingham City': ['birmingham city fc', 'birmingham city', 'birmingham'],
  'Watford': ['watford fc', 'watford'],
  'Middlesbrough': ['middlesbrough fc', 'middlesbrough', 'boro'],
  'Norwich City': ['norwich city fc', 'norwich city', 'norwich'],
  'Blackburn Rovers': ['blackburn rovers fc', 'blackburn rovers', 'blackburn'],
  'Stoke City': ['stoke city fc', 'stoke city', 'stoke'],
  'Oxford United': ['oxford united fc', 'oxford united', 'oxford'],
  'Queens Park Rangers': ['queens park rangers fc', 'queens park rangers', 'qpr'],
  'Millwall': ['millwall fc', 'millwall'],
  'Sheffield United': ['sheffield united fc', 'sheffield united', 'sheffield utd', 'sheff united', 'sheff utd'],
  'Sheffield Wednesday': ['sheffield wednesday fc', 'sheffield wednesday', 'sheff wednesday', 'sheff wed'],
  'West Bromwich Albion': ['west bromwich albion fc', 'west bromwich albion', 'west brom', 'wba'],
  'Leeds United': ['leeds united fc', 'leeds united', 'leeds'],
  'Sunderland': ['sunderland afc', 'sunderland fc', 'sunderland'],
  'Coventry City': ['coventry city fc', 'coventry city', 'coventry'],
  'Bristol City': ['bristol city fc', 'bristol city'],
  'Cardiff City': ['cardiff city fc', 'cardiff city', 'cardiff'],
  'Swansea City': ['swansea city fc', 'swansea city', 'swansea'],
  'Hull City': ['hull city fc', 'hull city', 'hull'],
  'Preston North End': ['preston north end fc', 'preston north end', 'preston'],
  'Derby County': ['derby county fc', 'derby county', 'derby'],
  'Portsmouth': ['portsmouth fc', 'portsmouth', 'pompey'],
  'Plymouth Argyle': ['plymouth argyle fc', 'plymouth argyle', 'plymouth'],
  'Luton Town': ['luton town fc', 'luton town', 'luton'],
  'Charlton Athletic': ['charlton athletic fc', 'charlton athletic', 'charlton'],
  'Wigan Athletic': ['wigan athletic fc', 'wigan athletic', 'wigan'],
  'Bolton Wanderers': ['bolton wanderers fc', 'bolton wanderers', 'bolton'],
  'Barnsley': ['barnsley fc', 'barnsley'],
  'Huddersfield Town': ['huddersfield town fc', 'huddersfield town', 'huddersfield'],
  'Reading': ['reading fc', 'reading'],
  'Blackpool': ['blackpool fc', 'blackpool'],
  'Peterborough United': ['peterborough united fc', 'peterborough united', 'peterborough'],
  'Wycombe Wanderers': ['wycombe wanderers fc', 'wycombe wanderers', 'wycombe'],
  'Rotherham United': ['rotherham united fc', 'rotherham united', 'rotherham'],

  // ═══ German 2. Bundesliga ═══
  'Hamburger SV': ['hamburger sv', 'hamburg', 'hsv'],
  'Hannover 96': ['hannover 96', 'hannover'],
  'Fortuna Dusseldorf': ['fortuna dusseldorf', 'f. dusseldorf', 'dusseldorf'],
  'SC Paderborn': ['sc paderborn 07', 'paderborn'],
  'Karlsruher SC': ['karlsruher sc', 'karlsruhe'],
  'FC Nurnberg': ['1. fc nurnberg', 'fc nurnberg', 'nurnberg'],
  'Kaiserslautern': ['1. fc kaiserslautern', 'kaiserslautern'],
  'Greuther Furth': ['spvgg greuther furth', 'greuther furth', 'furth'],
  'FC Magdeburg': ['1. fc magdeburg', 'magdeburg'],
  'Elversberg': ['sv elversberg', 'elversberg'],
  'Braunschweig': ['eintracht braunschweig', 'braunschweig'],

  // ═══ Italian Serie B ═══
  'Palermo': ['us citta di palermo', 'palermo'],
  'Sampdoria': ['uc sampdoria', 'sampdoria'],
  'Pisa': ['ac pisa 1909', 'pisa', 'ac pisa'],
  'Bari': ['ssc bari', 'bari', 'fc bari'],
  'Modena': ['modena fc', 'modena'],
  'Spezia': ['spezia calcio', 'spezia'],
  'Brescia': ['brescia calcio', 'brescia'],
  'Cosenza': ['cosenza calcio', 'cosenza'],
  'Cittadella': ['as cittadella', 'cittadella'],
  'Reggiana': ['ac reggiana 1919', 'reggiana'],
  'Sudtirol': ['fc sudtirol', 'sudtirol', 'fc suedtirol'],
  'Mantova': ['mantova 1911', 'mantova'],
  'Cesena': ['cesena fc', 'cesena'],
  'Juve Stabia': ['ss juve stabia', 'juve stabia'],
  'Salernitana': ['us salernitana 1919', 'salernitana'],
  'Frosinone': ['frosinone calcio', 'frosinone'],
  'Ascoli': ['ascoli calcio 1898', 'ascoli'],

  // ═══ French Ligue 2 ═══
  'Metz': ['fc metz', 'metz'],
  'Caen': ['sm caen', 'caen', 'stade malherbe caen'],
  'Bordeaux': ['girondins de bordeaux', 'bordeaux', 'fc girondins de bordeaux'],
  'Bastia': ['sc bastia', 'bastia'],
  'Ajaccio': ['ac ajaccio', 'ajaccio'],
  'Guingamp': ['ea guingamp', 'guingamp'],
  'Lorient': ['fc lorient', 'lorient'],
  'Auxerre': ['aj auxerre', 'auxerre'],
  'Amiens': ['amiens sc', 'amiens'],
  'Clermont': ['clermont foot 63', 'clermont foot', 'clermont'],
  'Grenoble': ['grenoble foot 38', 'grenoble'],
  'Laval': ['stade lavallois', 'laval'],
  'Dunkerque': ['usl dunkerque', 'dunkerque'],
  'Paris FC': ['paris fc', 'paris fc'],
  'Rodez': ['rodez af', 'rodez'],

  // ═══ Colombia ═══
  'Atletico Nacional': ['atletico nacional', 'club atletico nacional'],
  'Millonarios': ['millonarios fc', 'millonarios'],
  'America de Cali': ['america de cali', 'cd america de cali'],
  'Deportivo Cali': ['deportivo cali', 'asociacion deportivo cali'],
  'Junior': ['atletico junior', 'junior de barranquilla', 'junior fc'],
  'Santa Fe': ['independiente santa fe', 'santa fe'],
  'Deportes Tolima': ['deportes tolima', 'cd tolima'],

  // ═══ India ═══
  'Mumbai City': ['mumbai city fc', 'mumbai city'],
  'Mohun Bagan': ['atk mohun bagan', 'mohun bagan super giant', 'mohun bagan'],
  'Bengaluru FC': ['bengaluru fc', 'bengaluru'],
  'Kerala Blasters': ['kerala blasters fc', 'kerala blasters'],
  'East Bengal': ['east bengal fc', 'east bengal'],
};

// ─── Lookup ──────────────────────────────────────────────────────────────────

// Build reverse lookup: alias → canonical name
const aliasToCanonical: Map<string, string> = new Map();
for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
  aliasToCanonical.set(canonical.toLowerCase(), canonical);
  for (const alias of aliases) {
    aliasToCanonical.set(alias.toLowerCase(), canonical);
  }
}

/**
 * Resolve a team name to its canonical (English-friendly) form.
 * If not found in aliases, returns the original name cleaned up.
 */
export function resolveTeamName(name: string): string {
  const lower = name.toLowerCase().trim();

  // Direct lookup
  const direct = aliasToCanonical.get(lower);
  if (direct) return direct;

  // Try without common suffixes
  const stripped = lower
    .replace(/\s+(fc|afc|sc|cf|ac|sk|jk|1907|1909|1913|1929|1846)$/i, '')
    .replace(/^(fc|afc|ac|sc|ss|us|rc|og|sv|vf[lb]|tsg|sg|1\.\s*f[sc]v?)\s+/i, '')
    .trim();
  const strippedLookup = aliasToCanonical.get(stripped);
  if (strippedLookup) return strippedLookup;

  // Try partial match (team name contains a known alias)
  for (const [alias, canonical] of aliasToCanonical) {
    if (alias.length > 5 && (lower.includes(alias) || alias.includes(lower))) {
      return canonical;
    }
  }

  // Not found — return original name with basic cleanup
  return name.replace(/\s+(FC|AFC|SC|CF|AC)$/i, '').trim();
}

/**
 * Normalize a team name for dedup comparison.
 * Returns a consistent key that maps different spellings of the same team to the same string.
 */
export function normalizeTeamForDedup(name: string): string {
  return resolveTeamName(name).toLowerCase();
}

/**
 * Check if two team names refer to the same team.
 */
export function isSameTeam(name1: string, name2: string): boolean {
  return normalizeTeamForDedup(name1) === normalizeTeamForDedup(name2);
}
