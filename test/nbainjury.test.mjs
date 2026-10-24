import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { reportLinks, latestReport, reportTime, pdfStreams, pdfPages, textItems, textRows, parseReport, applyOfficial } from '../js/nbainjury.js';

// Pages drawn the way the league's PDF is (GemBox; positions from its 04:00 AM report of 24 Oct
// 2026): the page flipped, each cell's words placed one by one with relative moves inside its own
// text block, the header (page 1 only) one point left of its column, and a reason that runs to two
// lines drawn 7 points above and below its row, whose other cells are centred on it. One word is a
// hex string, one cell is placed through a transform and one reason is a kerned array.
const X = [24.15, 120.59, 200.95, 265.24, 425.98, 586.71, 667.07]; // Date, Time, Matchup, Team, Player, Status, Reason
const esc = (w) => w.replace(/[()\\]/g, (c) => `\\${c}`);
const cell = (x, y, text) => `BT\n/F1 -9 Tf\n${text.split(' ').map((w, i) => `${i ? '30 0' : `${x} ${y}`} Td (${esc(w)}) Tj`).join('\n')}\nET`;
const row = (y, cells, dx = 0) => cells.map((c, i) => (c ? cell(X[i] + dx, y, c) : '')).filter(Boolean).join('\n');
const reason = (y, text) => cell(X[6], y, text);
const title = 'q\n1 0 0 -1 0 595.35 cm -100 Tz\nBT\n1 g\n/F0 -22 Tf\n288.1306 62.0094 Td (Injury) Tj\n66.5049 0 Td (Report:) Tj\n82.7041 0 Td (10/24/26) Tj\nET';
const foot = (n) => `BT\n/F1 -9 Tf\n398.53 545.43 Td (Page) Tj\n21.9 0 Td (${n}) Tj\n7.33 0 Td (of) Tj\n10.59 0 Td (2) Tj\nET\nQ`;
const page1a = [
  title,
  row(115.23, ['Game Date', 'Game Time', 'Matchup', 'Team', 'Player Name', 'Current Status', 'Reason'], -1),
  row(136.26, ['10/24/2026', '06:00 (ET)', 'MIA@CHA', 'Miami Heat', '', '', 'NOT YET SUBMITTED']),
  row(159.29, ['', '', '', 'Charlotte Hornets', '', '', 'NOT YET SUBMITTED']),
  row(182.33, ['', '07:30 (ET)', 'BKN@CLE', 'Brooklyn Nets', 'Bilodeau, Tyler', 'Out', 'Injury/Illness - Right Shoulder Sprain']),
  reason(205.37, 'Injury/Illness - Left Knee Injury'),
  row(212.39, ['', '', '', 'Cleveland Cavaliers', 'Diop, Khalifa', 'Out', '']),
  reason(219.41, 'Management'),
  reason(241.45, 'Injury/Illness - Low Back Stress'),
  row(248.46, ['', '', '', '', "Tomlin, Nae'Qwan", 'Out', '']),
  reason(255.48, 'Reaction'),
].join('\n');
const page1b = [
  // Udeh: "Udeh," as a hex string, his status through a transform, his reason as a kerned array.
  `BT\n/F1 -9 Tf\n${X[4]} 277.52 Td <556465682C> Tj\n30 0 Td (Jr.,) Tj\n30 0 Td (Ernest) Tj\nET`,
  `q 1 0 0 1 ${X[5]} 0 cm\nBT\n/F1 -9 Tf\n0 277.52 Td (Out) Tj\nET\nQ`,
  `BT\n/F1 -9 Tf\n${X[6]} 277.52 Td [(G) -250 (League) -250 (-) -250 (Two-) 12 (Way)] TJ\nET`,
  row(300.56, ['', '', 'MIL@PHI', 'Milwaukee Bucks', '', '', 'NOT YET SUBMITTED']),
  reason(323.6, 'Injury/Illness - Low Back Stress'),
  row(330.62, ['', '', '', 'Philadelphia 76ers', 'Barlow, Dominick', 'Out', '']),
  reason(337.64, 'Reaction'),
  row(359.67, ['', '', '', '', 'Fall, Tacko', 'Out', 'Injury/Illness - Left Quadriceps Strain']),
  foot(1),
].join('\n');
// Page 2: no header row; Philadelphia's block carries on from page 1.
const page2 = [
  title,
  reason(84, 'Injury/Illness - Right Achilles Tendon'),
  row(91, ['', '', '', '', 'Hukporti, Ariel', 'Out', '']),
  reason(98, 'Rupture / Tear'),
  // The second line of a reason holding a status word: the rest of the reason, not a player.
  reason(113, 'Injury/Illness - Left Ankle;'),
  row(120, ['', '', '', '', 'Wade, Dean', 'Questionable', '']),
  reason(127, 'Bone Bruise; Out Indefinitely'),
  row(150, ['', '08:00 (ET)', 'SAS@DAL', 'San Antonio Spurs', '', '', 'NOT YET SUBMITTED']),
  row(173, ['', '', '', 'Dallas Mavericks', '', '', 'NOT YET SUBMITTED']),
  row(196, ['', '09:00 (ET)', 'NOP@DEN', 'New Orleans Pelicans', '', '', 'NOT YET SUBMITTED']),
  row(219, ['', '', '', 'Denver Nuggets', 'Diallo, Alpha', 'Questionable', 'Injury/Illness - Right Wrist Sprain']),
  // A game of teams the reader does not know: left out, never given to Denver.
  // A hyphenated name and reason drawn as two words each.
  row(242, ['', '', '', '', 'Caldwell- Pope, Kentavious', 'Out', 'G League - Two- Way']),
  row(265, ['', '10:00 (ET)', 'ABC@XYZ', 'Somewhere Stars', 'Doe, John', 'Out', 'Illness']),
  row(288, ['', '', '', '', 'Roe, Jim', 'Out', 'Illness']),
  foot(2),
].join('\n');

// A PDF file of numbered objects: [number, dictionary, stream bytes?].
const pdfOf = (objs) => Buffer.concat([
  Buffer.from('%PDF-1.4\n', 'latin1'),
  ...objs.flatMap(([n, dict, data]) => [Buffer.from(`${n} 0 obj\n${dict}\n`, 'latin1'), ...(data ? [Buffer.from('stream\n', 'latin1'), data, Buffer.from('\nendstream\n', 'latin1')] : []), Buffer.from('endobj\n', 'latin1')]),
  Buffer.from('trailer\n<< /Size 10 /Root 1 0 R >>\n%%EOF\n', 'latin1'),
]);
const z = (s) => deflateSync(Buffer.from(s, 'latin1'));
// File order: page 2's content first, then an image (not deflated) and a font (deflated, binary),
// then page 1's two streams; the page tree lists page 1 first.
const PDF = pdfOf([
  [1, '<< /Type /Catalog /Pages 2 0 R >>'],
  [2, '<< /Type /Pages /Kids [7 0 R 3 0 R] /Count 2 >>'],
  [3, '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>'],
  [4, '<< /Length 0 /Filter /FlateDecode >>', z(page2)],
  [5, '<< /Type /XObject /Subtype /Image /Filter /DCTDecode >>', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])],
  [6, '<< /Length1 64 /Filter /FlateDecode >>', deflateSync(Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37) % 256)))],
  [7, '<< /Type /Page /Parent 2 0 R /Contents [8 0 R 9 0 R] >>'],
  [8, '<< /Length 0 /Filter /FlateDecode >>', z(page1a)],
  [9, '<< /Length 0 /Filter /FlateDecode >>', z(page1b)],
]);

test('NBA injury report: the latest PDF from the page and its publication time (US Eastern, with summer time)', () => {
  const html = '<a href="https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-24_02_45AM.pdf">x</a> <a href="https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-23_05_30PM.pdf">y</a> <a href="https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-24_01_00PM.pdf">z</a>';
  const links = reportLinks(html);
  assert.equal(links.length, 3);
  assert.equal(latestReport(links), 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-24_01_00PM.pdf');
  const at = (f) => new Date(reportTime(`https://ak-static.cms.nba.com/referee/injury/Injury-Report_${f}.pdf`)).toISOString();
  assert.equal(at('2026-10-24_02_45AM'), '2026-10-24T06:45:00.000Z', '2:45 am EDT');
  assert.equal(at('2026-11-10_05_30PM'), '2026-11-10T22:30:00.000Z', '5:30 pm EST, after the clocks go back on 1 November');
  assert.equal(at('2026-03-08_01_30AM'), '2026-03-08T06:30:00.000Z', 'before 2 am on the day the clocks go forward');
  assert.equal(at('2026-03-08_03_00AM'), '2026-03-08T07:00:00.000Z', 'after it');
});

test('NBA injury report: every stream is read (the "stream" in "endstream" skips none), pages in the page tree\'s order', () => {
  assert.equal(pdfStreams(PDF, inflateSync).length, 4, 'the four deflated streams; the image is passed over');
  const pages = pdfPages(PDF, inflateSync);
  assert.equal(pages.length, 2);
  assert.match(pages[0], /Bilodeau/);
  assert.match(pages[0], /Fall/, 'page 1 joins its two streams');
  assert.match(pages[1], /Hukporti/);
  // Without a readable page tree: every stream, in file order.
  assert.equal(pdfPages(Buffer.from(PDF.toString('latin1').replace('/Root 1 0 R', ''), 'latin1'), inflateSync).length, 4);
});

test('NBA injury report: words land where the transforms put them, rows top to bottom, read by what their cells hold', () => {
  const pages = pdfPages(PDF, inflateSync).map((c) => textRows(textItems(c)));
  assert.deepEqual(pages[0][0].words.map((w) => w.s), ['Injury', 'Report:', '10/24/26'], 'the title on top');
  const udeh = pages[0].find((r) => r.words.some((w) => w.s === 'Ernest'));
  assert.deepEqual(udeh.words.map((w) => [w.s, w.x]), [['Udeh,', 425.98], ['Jr.,', 455.98], ['Ernest', 485.98], ['Out', 586.71], ['G League - Two-Way', 667.07]]);
  const entries = parseReport(pages);
  assert.deepEqual(entries.map((x) => [x.matchup, x.team, x.player, x.status, x.reason]), [
    ['BKN@CLE', 'Brooklyn Nets', 'Tyler Bilodeau', 'Out', 'Injury/Illness - Right Shoulder Sprain'],
    ['BKN@CLE', 'Cleveland Cavaliers', 'Khalifa Diop', 'Out', 'Injury/Illness - Left Knee Injury Management'],
    ['BKN@CLE', 'Cleveland Cavaliers', "Nae'Qwan Tomlin", 'Out', 'Injury/Illness - Low Back Stress Reaction'],
    ['BKN@CLE', 'Cleveland Cavaliers', 'Ernest Udeh Jr.', 'Out', 'G League - Two-Way'],
    ['MIL@PHI', 'Philadelphia 76ers', 'Dominick Barlow', 'Out', 'Injury/Illness - Low Back Stress Reaction'],
    ['MIL@PHI', 'Philadelphia 76ers', 'Tacko Fall', 'Out', 'Injury/Illness - Left Quadriceps Strain'],
    ['MIL@PHI', 'Philadelphia 76ers', 'Ariel Hukporti', 'Out', 'Injury/Illness - Right Achilles Tendon Rupture / Tear'],
    ['MIL@PHI', 'Philadelphia 76ers', 'Dean Wade', 'Questionable', 'Injury/Illness - Left Ankle; Bone Bruise; Out Indefinitely'],
    ['NOP@DEN', 'Denver Nuggets', 'Alpha Diallo', 'Questionable', 'Injury/Illness - Right Wrist Sprain'],
    ['NOP@DEN', 'Denver Nuggets', 'Kentavious Caldwell-Pope', 'Out', 'G League - Two-Way'],
  ], 'reasons whole, Philadelphia carried over the page break, the unknown game left out');
  assert.equal(entries[0].date, '10/24/2026');
  assert.equal(entries[0].time, '07:30 (ET)');
  assert.equal(entries.at(-1).time, '09:00 (ET)');
});

test('NBA injury report onto a game: the league\'s status wins, missing players are added, "available" ones leave', () => {
  const e = { home: 'Boston Celtics', away: 'New York Knicks', injuries: { home: [{ id: '1', name: 'Jayson Tatum', status: 'Out' }], away: [{ id: '2', name: 'Jalen Brunson', status: 'Day-To-Day' }] } };
  const entries = [
    { team: 'New York Knicks', player: 'Jalen Brunson', status: 'Questionable', reason: 'Ankle' },
    { team: 'New York Knicks', player: 'Josh Hart', status: 'Out', reason: 'Knee' },
    { team: 'Boston Celtics', player: 'Jayson Tatum', status: 'Available', reason: '' },
    { team: 'Miami Heat', player: 'Someone Else', status: 'Out', reason: '' },
  ];
  const tally = {};
  assert.equal(applyOfficial(e, entries, (n) => (n === 'Josh Hart' ? '3' : null), tally), 3);
  assert.deepEqual(e.injuries.away.map((x) => [x.id, x.name, x.status, x.official]), [['2', 'Jalen Brunson', 'Questionable', true], ['3', 'Josh Hart', 'Out', true]]);
  assert.deepEqual(e.injuries.home, [], 'cleared to play: off the list');
  assert.deepEqual(tally, { both: 1, changed: 1, added: 1, cleared: 1 });
});
