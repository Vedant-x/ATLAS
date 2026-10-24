// Every sport and competition ATLAS tracks, organised Sport → Group → League.
// `path` is the ESPN API path (sport/league). NPB and KBO come from the official league sites
// (built by scripts/pages.mjs), so their path starts with "atlas/". So do cricket, F1 and esports.

// demand: a league no bookmaker feed here prices (college volleyball, soccer, hockey, field hockey).
// The build leaves it out (it was a third of the board and none of it could be bet or checked); its
// page still loads it straight from ESPN when opened.
const L = (path, name, short, extra = {}) => ({ path, name, short: short || name, ...extra });

export const CATALOG = [
  {
    id: 'football', name: 'Soccer', icon: '⚽', color: '#d2ff00', model: 'football',
    groups: [
      { name: 'Top leagues', leagues: [L('soccer/eng.1', 'Premier League', 'EPL'), L('soccer/esp.1', 'LALIGA'), L('soccer/ger.1', 'Bundesliga'), L('soccer/ita.1', 'Serie A'), L('soccer/fra.1', 'Ligue 1')] },
      { name: 'UEFA', leagues: [L('soccer/uefa.champions', 'Champions League', 'UCL'), L('soccer/uefa.europa', 'Europa League', 'UEL'), L('soccer/uefa.europa.conf', 'Conference League', 'UECL'), L('soccer/uefa.nations', 'Nations League'), L('soccer/uefa.champions_qual', 'UCL Qualifying'), L('soccer/uefa.europa_qual', 'UEL Qualifying'), L('soccer/uefa.super_cup', 'UEFA Super Cup')] },
      { name: 'England', leagues: [L('soccer/eng.2', 'Championship'), L('soccer/eng.3', 'League One'), L('soccer/eng.4', 'League Two'), L('soccer/eng.5', 'National League'), L('soccer/eng.fa', 'FA Cup'), L('soccer/eng.league_cup', 'Carabao Cup'), L('soccer/eng.trophy', 'EFL Trophy')] },
      { name: 'Spain', leagues: [L('soccer/esp.2', 'LALIGA 2'), L('soccer/esp.copa_del_rey', 'Copa del Rey'), L('soccer/esp.super_cup', 'Supercopa')] },
      { name: 'Germany', leagues: [L('soccer/ger.2', '2. Bundesliga'), L('soccer/ger.dfb_pokal', 'DFB-Pokal')] },
      { name: 'Italy', leagues: [L('soccer/ita.2', 'Serie B'), L('soccer/ita.coppa_italia', 'Coppa Italia')] },
      { name: 'France', leagues: [L('soccer/fra.2', 'Ligue 2'), L('soccer/fra.coupe_de_france', 'Coupe de France')] },
      { name: 'Rest of Europe', leagues: [L('soccer/ned.1', 'Eredivisie'), L('soccer/ned.2', 'Eerste Divisie'), L('soccer/por.1', 'Primeira Liga'), L('soccer/bel.1', 'Belgian Pro League'), L('soccer/tur.1', 'Süper Lig'), L('soccer/sco.1', 'Scottish Premiership'), L('soccer/sco.2', 'Scottish Championship'), L('soccer/aut.1', 'Austrian Bundesliga'), L('soccer/gre.1', 'Greek Super League'), L('soccer/den.1', 'Danish Superliga'), L('soccer/swe.1', 'Allsvenskan'), L('soccer/nor.1', 'Eliteserien'), L('soccer/rus.1', 'Russian Premier League'), L('soccer/ned.cup', 'KNVB Beker'), L('soccer/por.taca.portugal', 'Taça de Portugal'), L('soccer/sco.tennents', 'Scottish Cup'), L('soccer/sco.cis', 'Scottish League Cup')] },
      { name: 'North & Central America', leagues: [L('soccer/usa.1', 'MLS'), L('soccer/usa.usl.1', 'USL Championship'), L('soccer/usa.usl.l1', 'USL League One'), L('soccer/usa.open', 'U.S. Open Cup'), L('soccer/mex.1', 'Liga MX'), L('soccer/mex.2', 'Liga de Expansión'), L('soccer/concacaf.champions', 'Concacaf Champions Cup'), L('soccer/concacaf.leagues.cup', 'Leagues Cup'), L('soccer/hon.1', 'Honduras Liga Nacional'), L('soccer/crc.1', 'Costa Rica Primera'), L('soccer/gua.1', 'Guatemala Liga Nacional'), L('soccer/slv.1', 'El Salvador Primera')] },
      { name: 'South America', leagues: [L('soccer/conmebol.libertadores', 'Libertadores'), L('soccer/conmebol.sudamericana', 'Sudamericana'), L('soccer/bra.1', 'Brasileirão Série A'), L('soccer/bra.2', 'Brasileirão Série B'), L('soccer/bra.copa_do_brazil', 'Copa do Brasil'), L('soccer/bra.camp.paulista', 'Paulista A1'), L('soccer/bra.camp.carioca', 'Carioca'), L('soccer/arg.1', 'Liga Profesional'), L('soccer/arg.2', 'Primera Nacional'), L('soccer/arg.copa', 'Copa Argentina'), L('soccer/chi.1', 'Chile Primera'), L('soccer/col.1', 'Colombia Primera A'), L('soccer/per.1', 'Peru Liga 1'), L('soccer/uru.1', 'Uruguay Primera'), L('soccer/ecu.1', 'LigaPro Ecuador'), L('soccer/par.1', 'Paraguay Primera'), L('soccer/bol.1', 'Bolivia Primera'), L('soccer/ven.1', 'Venezuela Primera')] },
      { name: 'Asia & Oceania', leagues: [L('soccer/jpn.1', 'J1 League'), L('soccer/chn.1', 'Chinese Super League'), L('soccer/ksa.1', 'Saudi Pro League'), L('soccer/ind.1', 'Indian Super League'), L('soccer/aus.1', 'A-League Men'), L('soccer/afc.champions', 'AFC Champions League Elite'), L('soccer/afc.cup', 'AFC Champions League Two')] },
      { name: 'Africa', leagues: [L('soccer/rsa.1', 'South African Premiership'), L('soccer/caf.champions', 'CAF Champions League'), L('soccer/caf.confed', 'CAF Confederation Cup')] },
      { name: 'International', leagues: [L('soccer/fifa.world', 'FIFA World Cup'), L('soccer/fifa.worldq.uefa', 'WC Qualifying · UEFA'), L('soccer/fifa.worldq.conmebol', 'WC Qualifying · CONMEBOL'), L('soccer/fifa.worldq.concacaf', 'WC Qualifying · Concacaf'), L('soccer/fifa.worldq.afc', 'WC Qualifying · AFC'), L('soccer/fifa.worldq.caf', 'WC Qualifying · CAF'), L('soccer/fifa.friendly', 'International Friendlies'), L('soccer/uefa.euro', 'EURO'), L('soccer/uefa.euroq', 'EURO Qualifying'), L('soccer/conmebol.america', 'Copa América'), L('soccer/concacaf.gold', 'Gold Cup'), L('soccer/caf.nations', 'Africa Cup of Nations'), L('soccer/afc.asian.cup', 'AFC Asian Cup'), L('soccer/fifa.cwc', 'Club World Cup')] },
      { name: 'Women', leagues: [L('soccer/eng.w.1', "Women's Super League"), L('soccer/usa.nwsl', 'NWSL'), L('soccer/esp.w.1', 'Liga F'), L('soccer/fra.w.1', 'Première Ligue'), L('soccer/uefa.wchampions', "Women's Champions League"), L('soccer/aus.w.1', 'A-League Women'), L('soccer/fifa.wwc', "Women's World Cup")] },
      { name: 'College', leagues: [L('soccer/usa.ncaa.m.1', "NCAA Men's Soccer", '', { demand: true }), L('soccer/usa.ncaa.w.1', "NCAA Women's Soccer", '', { demand: true })] },
    ],
  },
  {
    id: 'basketball', name: 'Basketball', icon: '🏀', color: '#ff7a1a', model: 'basketball',
    groups: [
      { name: 'Pro', leagues: [L('basketball/nba', 'NBA'), L('basketball/wnba', 'WNBA'), L('basketball/nba-development', 'NBA G League'), L('basketball/nbl', 'NBL (Australia)')] },
      { name: 'College', leagues: [L('basketball/mens-college-basketball', "NCAA Men's"), L('basketball/womens-college-basketball', "NCAA Women's")] },
      { name: 'Europe', leagues: [L('atlas/euroleague', 'EuroLeague'), L('atlas/eurocup', 'EuroCup')] },
      { name: 'International', leagues: [L('basketball/fiba', 'FIBA World Cup')] },
      { name: 'More leagues', leagues: [L('atlas/basketball-more', 'ACB, Greek GBL, NZ NBL, Turkish BSL, KBL, Champions League & more', 'More leagues')] },
    ],
  },
  {
    id: 'americanfootball', name: 'American Football', icon: '🏈', color: '#ff9f43', model: 'americanfootball',
    groups: [
      { name: 'Pro', leagues: [L('football/nfl', 'NFL'), L('football/cfl', 'CFL'), L('football/ufl', 'UFL')] },
      { name: 'College', leagues: [L('football/college-football', 'NCAA Football (FBS + FCS)', 'NCAAF', { also: ['groups=81'] })] },
    ],
  },
  {
    id: 'hockey', name: 'Ice Hockey', icon: '🏒', color: '#b08cff', model: 'hockey',
    groups: [
      { name: 'Pro', leagues: [L('hockey/nhl', 'NHL'), L('atlas/khl', 'KHL (Russia)', 'KHL')] },
      { name: 'Europe', leagues: [L('atlas/liiga', 'Liiga (Finland)', 'Liiga'), L('atlas/swissnl', 'Swiss hockey (National League & Swiss League)', 'Swiss hockey')] },
      { name: 'College', leagues: [L('hockey/mens-college-hockey', "NCAA Men's Hockey", '', { demand: true }), L('hockey/womens-college-hockey', "NCAA Women's Hockey", '', { demand: true })] },
    ],
  },
  {
    id: 'baseball', name: 'Baseball', icon: '⚾', color: '#ffd84d', model: 'baseball',
    groups: [
      { name: 'Pro', leagues: [L('baseball/mlb', 'MLB'), L('atlas/npb', 'NPB (Japan)', 'NPB'), L('atlas/kbo', 'KBO (Korea)', 'KBO')] },
      { name: 'Winter leagues', leagues: [L('baseball/dominican-winter-league', 'Dominican Winter League'), L('baseball/caribbean-series', 'Caribbean Series'), L('atlas/mexican-baseball', 'Mexican leagues (LMP, LMB)', 'Mexican baseball')] },
      { name: 'College', leagues: [L('baseball/college-baseball', 'NCAA Baseball'), L('baseball/college-softball', 'NCAA Softball')] },
    ],
  },
  {
    id: 'tennis', name: 'Tennis', icon: '🎾', color: '#9dff5c', model: 'tennis',
    groups: [{ name: 'Tours', leagues: [L('tennis/atp', 'ATP Tour', 'ATP'), L('tennis/wta', 'WTA Tour', 'WTA')] }],
  },
  {
    id: 'mma', name: 'MMA', icon: '🥊', color: '#ff3d6e', model: 'mma',
    groups: [{ name: 'Promotions', leagues: [L('mma/ufc', 'UFC'), L('mma/pfl', 'PFL'), L('mma/bellator', 'Bellator'), L('mma/ofc', 'ONE Championship'), L('mma/cage-warriors', 'Cage Warriors'), L('mma/lfa', 'LFA'), L('mma/ksw', 'KSW'), L('mma/rizin', 'RIZIN')] }],
  },
  {
    id: 'rugby', name: 'Rugby', icon: '🏉', color: '#4fd1ff', model: 'rugby',
    groups: [
      { name: 'Union · International', leagues: [L('rugby/180659', 'Six Nations'), L('rugby/244293', 'The Rugby Championship'), L('rugby/164205', 'Rugby World Cup'), L('rugby/289234', 'Test Matches')] },
      { name: 'Union · Club', leagues: [L('rugby/267979', 'Gallagher Premiership'), L('rugby/270557', 'United Rugby Championship', 'URC'), L('rugby/270559', 'Top 14'), L('rugby/271937', 'Champions Cup'), L('rugby/272073', 'Challenge Cup'), L('rugby/242041', 'Super Rugby Pacific'), L('rugby/289262', 'Major League Rugby'), L('rugby/270555', 'Currie Cup')] },
      { name: 'League', leagues: [L('rugby-league/3', 'NRL'), L('atlas/rugbyleague-more', 'Super League, NRLW, State of Origin & more', 'More rugby league')] },
    ],
  },
  {
    id: 'aussierules', name: 'Aussie Rules', icon: '🦘', color: '#ffb84d', model: 'aussierules',
    groups: [{ name: 'AFL', leagues: [L('australian-football/afl', 'AFL'), L('atlas/aussie-more', 'AFLW & VFL', 'AFLW / VFL')] }],
  },
  {
    id: 'lacrosse', name: 'Lacrosse', icon: '🥍', color: '#7cf0c4', model: 'binary',
    groups: [{ name: 'Leagues', leagues: [L('lacrosse/pll', 'Premier Lacrosse League', 'PLL'), L('lacrosse/nll', 'National Lacrosse League', 'NLL'), L('lacrosse/mens-college-lacrosse', "NCAA Men's"), L('lacrosse/womens-college-lacrosse', "NCAA Women's")] }],
  },
  {
    id: 'cricket', name: 'Cricket', icon: '🏏', color: '#4dd2ff', model: 'binary',
    groups: [{ name: 'Cricket', leagues: [L('atlas/cricket-intl', 'International (Tests, ODIs, T20Is)', 'International'), L('atlas/cricket-t20', 'T20 & franchise leagues', 'T20 leagues'), L('atlas/cricket-dom', 'Domestic & other', 'Domestic')] }],
  },
  {
    id: 'f1', name: 'Formula 1', icon: '🏎️', color: '#ff2a2a', model: 'race',
    groups: [{ name: 'World Championship', leagues: [L('atlas/f1', 'Formula 1 World Championship', 'F1')] }],
  },
  // Field events (js/fields.js): a tournament or race is a field, not a two-sided match.
  { id: 'golf', name: 'Golf', icon: '⛳', color: '#5cd68b', model: 'field', groups: [{ name: 'Tours', leagues: [L('atlas/golf-pga', 'PGA Tour', 'PGA', { only: 'pga' }), L('atlas/golf-lpga', 'LPGA Tour', 'LPGA', { only: 'lpga' }), L('atlas/golf-eur', 'DP World Tour', 'DP World', { only: 'eur' }), L('atlas/golf-champions', 'PGA Tour Champions', 'Champions', { only: 'champions-tour' })] }] },
  { id: 'motorsport', name: 'Motor Racing', icon: '🏁', color: '#ffb347', model: 'field', groups: [{ name: 'Series', leagues: [L('atlas/nascar', 'NASCAR Cup Series', 'NASCAR', { only: 'nascar-premier' }), L('atlas/nascar-xfinity', "NASCAR O'Reilly Series", 'NASCAR 2', { only: 'nascar-secondary' }), L('atlas/nascar-truck', 'NASCAR Truck Series', 'Trucks', { only: 'nascar-truck' }), L('atlas/indycar', 'IndyCar Series', 'IndyCar', { only: 'irl' })] }, { name: 'Motorcycles', leagues: [L('atlas/motogp', 'MotoGP', 'MotoGP', { only: 'motogp-motogp' }), L('atlas/moto2', 'Moto2', 'Moto2', { only: 'motogp-moto2' }), L('atlas/moto3', 'Moto3', 'Moto3', { only: 'motogp-moto3' })] }] },
  {
    id: 'esports', name: 'Esports', icon: '🎮', color: '#a46bff', model: 'esports',
    groups: [
      { name: 'Shooters', leagues: [L('atlas/cs2', 'Counter-Strike 2', 'CS2'), L('atlas/valorant', 'Valorant')] },
      { name: 'MOBA', leagues: [L('atlas/lol', 'League of Legends', 'LoL'), L('atlas/dota2', 'Dota 2')] },
    ],
  },
  {
    id: 'efootball', name: 'eSoccer (FIFA)', icon: '🕹️', color: '#2bff88', model: 'football',
    groups: [{ name: 'EA FC', leagues: [L('atlas/esoccer', 'eSoccer Battle (EA FC, 2×4 min)', 'eSoccer')] }],
  },
  {
    id: 'fieldhockey', name: 'Field Hockey', icon: '🏑', color: '#5cffb0', model: 'binary',
    groups: [{ name: 'College', leagues: [L('field-hockey/womens-college-field-hockey', "NCAA Women's", '', { demand: true })] }],
  },
  {
    id: 'waterpolo', name: 'Water Polo', icon: '🤽', color: '#4da6ff', model: 'binary',
    groups: [{ name: 'College', leagues: [L('water-polo/mens-college-water-polo', "NCAA Men's"), L('water-polo/womens-college-water-polo', "NCAA Women's")] }],
  },
  {
    id: 'volleyball', name: 'Volleyball', icon: '🏐', color: '#ffe36e', model: 'binary',
    groups: [
      { name: 'Pro & international', leagues: [L('atlas/volleyball', 'Pro leagues & internationals', 'Pro volleyball')] },
      { name: 'College', leagues: [L('volleyball/mens-college-volleyball', "NCAA Men's", '', { demand: true }), L('volleyball/womens-college-volleyball', "NCAA Women's", '', { demand: true })] },
    ],
  },
  // From TheSportsDB (js/sportsdb.js): fixtures, scores and each side's recent results, no prices.
  { id: 'darts', name: 'Darts', icon: '🎯', color: '#ff5c5c', model: 'binary', groups: [{ name: 'Darts', leagues: [L('atlas/darts', 'PDC & world events', 'Darts')] }] },
  { id: 'snooker', name: 'Snooker', icon: '🎱', color: '#3ddc84', model: 'binary', groups: [{ name: 'Snooker', leagues: [L('atlas/snooker', 'World Snooker Tour', 'Snooker')] }] },
  { id: 'handball', name: 'Handball', icon: '🤾', color: '#ffb347', model: 'binary', groups: [{ name: 'Handball', leagues: [L('atlas/handball', 'Leagues & internationals', 'Handball')] }] },
  { id: 'tabletennis', name: 'Table Tennis', icon: '🏓', color: '#ff7eb6', model: 'binary', groups: [{ name: 'Table tennis', leagues: [L('atlas/tabletennis', 'Table tennis', 'Table tennis')] }] },
  { id: 'badminton', name: 'Badminton', icon: '🏸', color: '#b5f2ff', model: 'binary', groups: [{ name: 'Badminton', leagues: [L('atlas/badminton', 'BWF & leagues', 'Badminton')] }] },
  { id: 'boxing', name: 'Boxing', icon: '🥊', color: '#ff4d4d', model: 'binary', groups: [{ name: 'Boxing', leagues: [L('atlas/boxing', 'Title & major fights', 'Boxing')] }] },
  { id: 'netball', name: 'Netball', icon: '🏐', color: '#ffd1f0', model: 'binary', groups: [{ name: 'Netball', leagues: [L('atlas/netball', 'Netball', 'Netball')] }] },
  { id: 'gaelic', name: 'Gaelic Games', icon: '☘️', color: '#4ce07a', model: 'binary', groups: [{ name: 'GAA', leagues: [L('atlas/gaelic', 'Gaelic football & hurling', 'GAA')] }] },
];

// Matches the bookmakers list that no feed above carries (The Odds API's free fixture lists, added by
// scripts/pages.mjs): one catch-all league per sport, each match named by its real competition.
for (const id of ['football', 'basketball', 'americanfootball', 'hockey', 'baseball', 'tennis', 'mma', 'boxing', 'rugby', 'aussierules', 'cricket', 'handball']) {
  CATALOG.find((s) => s.id === id)?.groups.push({ name: 'Bookmaker listings', leagues: [L(`atlas/odds-${id}`, "Other competitions on the bookmakers' boards", 'Other competitions')] });
}

export const ALL_LEAGUES = CATALOG.flatMap((s) => s.groups.flatMap((g) => g.leagues.map((l) => ({ ...l, sport: s.id, group: g.name }))));
export const sportById = (id) => CATALOG.find((s) => s.id === id);
export const leagueByPath = (path) => ALL_LEAGUES.find((l) => l.path === path);
export const leagueKey = (path) => path.replace(/\//g, '~');
export const leagueFromKey = (key) => leagueByPath(key.replace(/~/g, '/'));
