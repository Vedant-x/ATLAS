import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { reportLinks, latestReport, reportTime, pdfStreams, pdfPages, textItems, textRows, parseReport, applyOfficial } from '../js/nbainjury.js';

// Pages drawn the way the league's PDF is (GemBox): the page flipped, each cell's words placed one by
// one with relative moves inside its own text block. The header is centred over its columns (so it
// starts right of the cells below it), one cell is placed through a transform, one word is a hex
// string and one reason a kerned array.
const X = [20, 90, 150, 240, 420, 560, 660]; // column starts: Date, Time, Matchup, Team, Player, Status, Reason
const esc = (w) => w.replace(/[()\\]/g, (c) => `\\${c}`);
const cell = (x, y, text) => `BT\n/F1 -9 Tf\n${text.split(' ').map((w, i) => `${i ? '30 0' : `${x} ${y}`} Td (${esc(w)}) Tj`).join('\n')}\nET`;
const row = (y, cells, dx = 0) => cells.map((c, i) => (c ? cell(X[i] + dx, y, c) : '')).filter(Boolean).join('\n');
const title = 'q\n1 0 0 -1 0 595.35 cm -100 Tz\nBT\n1 g\n/F0 -22 Tf\n288.1306 62.0094 Td (Injury) Tj\n66.5049 0 Td (Report:) Tj\n82.7041 0 Td (10/24/26) Tj\nET';
const foot = (n) => `BT\n/F1 -9 Tf\n380 580 Td (Page) Tj\n30 0 Td (${n}) Tj\n30 0 Td (of) Tj\n30 0 Td (2) Tj\nET\nQ`;
const page1a = [
  title,
  row(100, ['Game Date', 'Game Time', 'Matchup', 'Team', 'Player Name', 'Current Status', 'Reason'], 12),
  row(115, ['10/24/2026', '07:30 (ET)', 'NYK@BOS', 'New York Knicks', 'Brunson, Jalen', 'Questionable', 'Injury/Illness - Left Ankle;']),
  row(125, ['', '', '', '', '', '', 'Sprain']),
  // Hart: his name as a hex string, his status through a transform, his reason as a kerned array.
  `BT\n/F1 -9 Tf\n${X[4]} 135 Td <486172742C> Tj\n30 0 Td (Josh) Tj\nET`,
  `q 1 0 0 1 ${X[5]} 0 cm\nBT\n/F1 -9 Tf\n0 135 Td (Out) Tj\nET\nQ`,
  `BT\n/F1 -9 Tf\n${X[6]} 135 Td [(Injury/Illness) -250 (-) -250 (Right) -250 (Kn) 12 (ee)] TJ\nET`,
].join('\n');
const page1b = [
  row(145, ['', '', '', 'Boston Celtics', 'Tatum, Jayson', 'Available', 'Injury/Illness - Achilles']),
  row(155, ['', '', '', '', 'Porzingis, Kristaps', 'Doubtful', 'Illness']),
  row(165, ['', '', 'MIA@CHA', 'Miami Heat', '', '', 'NOT YET SUBMITTED']),
  row(175, ['', '', '', 'Charlotte Hornets', 'Ball, LaMelo', 'Probable', 'Injury/Illness - Right Ankle']),
  // The team's name wraps onto a second line, beside the rest of the reason.
  row(185, ['', '', 'POR@SAC', 'Portland Trail', 'Grant, Jerami', 'Out', 'Injury/Illness - Left Knee;']),
  row(195, ['', '', '', 'Blazers', '', '', 'Tendinopathy']),
  foot(1),
].join('\n');
// Page 2: no header row; Portland's block carries on from page 1.
const page2 = [
  title,
  row(100, ['', '', '', '', 'Simons, Anfernee', 'Doubtful', 'Illness']),
  // A status a line below its name (the cell centred in a taller row).
  row(110, ['', '', '', 'Sacramento Kings', 'Murray, Keegan', '', 'Injury/Illness - Left Thumb;']),
  row(116, ['', '', '', '', '', 'Out', '']),
  // A reason that wraps onto a line holding a status word: the rest of the reason, not a player.
  row(130, ['', '', '', '', 'Sabonis, Domantas', 'Questionable', 'Injury/Illness - Left Knee;']),
  row(140, ['', '', '', '', '', '', 'Bruise; Out Indefinitely']),
  // A game of teams the reader does not know: left out, never given to Sacramento.
  row(150, ['10/25/2026', '01:00 (ET)', 'ABC@XYZ', 'Somewhere Stars', 'Doe, John', 'Out', 'Illness']),
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
  assert.match(pages[0], /Brunson/);
  assert.match(pages[0], /Charlotte/, 'page 1 joins its two streams');
  assert.match(pages[1], /Simons/);
  // Without a readable page tree: every stream, in file order.
  assert.equal(pdfPages(Buffer.from(PDF.toString('latin1').replace('/Root 1 0 R', ''), 'latin1'), inflateSync).length, 4);
});

test('NBA injury report: words land where the transforms put them, rows top to bottom, read by what their cells hold', () => {
  const pages = pdfPages(PDF, inflateSync).map((c) => textRows(textItems(c)));
  assert.deepEqual(pages[0][0].words.map((w) => w.s), ['Injury', 'Report:', '10/24/26'], 'the title on top');
  const hart = pages[0].find((r) => r.words.some((w) => w.s === 'Josh'));
  assert.deepEqual(hart.words.map((w) => [w.s, w.x]), [['Hart,', 420], ['Josh', 450], ['Out', 560], ['Injury/Illness - Right Knee', 660]]);
  const entries = parseReport(pages);
  assert.deepEqual(entries.map((x) => [x.team, x.player, x.status]), [
    ['New York Knicks', 'Jalen Brunson', 'Questionable'], ['New York Knicks', 'Josh Hart', 'Out'],
    ['Boston Celtics', 'Jayson Tatum', 'Available'], ['Boston Celtics', 'Kristaps Porzingis', 'Doubtful'],
    ['Charlotte Hornets', 'LaMelo Ball', 'Probable'],
    ['Portland Trail Blazers', 'Jerami Grant', 'Out'], ['Portland Trail Blazers', 'Anfernee Simons', 'Doubtful'],
    ['Sacramento Kings', 'Keegan Murray', 'Out'], ['Sacramento Kings', 'Domantas Sabonis', 'Questionable'],
  ]);
  const by = (p) => entries.find((x) => x.player === p);
  assert.equal(by('Jalen Brunson').reason, 'Injury/Illness - Left Ankle; Sprain', 'a wrapped reason joins its row');
  assert.equal(by('Josh Hart').reason, 'Injury/Illness - Right Knee');
  assert.equal(by('Jerami Grant').reason, 'Injury/Illness - Left Knee; Tendinopathy', 'beside the rest of a wrapped team name');
  assert.equal(by('Keegan Murray').reason, 'Injury/Illness - Left Thumb;', 'a status a line below its name');
  assert.equal(by('Domantas Sabonis').reason, 'Injury/Illness - Left Knee; Bruise; Out Indefinitely', 'a status word in a wrapped reason is not a player');
  assert.deepEqual([by('Jalen Brunson').matchup, by('LaMelo Ball').matchup, by('Anfernee Simons').matchup], ['NYK@BOS', 'MIA@CHA', 'POR@SAC'], 'carried across the page break');
  assert.equal(by('Jalen Brunson').date, '10/24/2026');
  assert.equal(by('Jalen Brunson').time, '07:30 (ET)');
  assert.ok(!entries.some((x) => x.player === 'John Doe'), 'an unknown team is left out');
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
