import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { reportLinks, latestReport, reportTime, pdfStreams, textItems, textRows, parseReport, applyOfficial } from '../js/nbainjury.js';

// A page drawn the way the league's PDF is (GemBox): the page flipped, each cell's words placed one
// by one with relative moves inside its own text block.
const X = [20, 90, 150, 240, 420, 560, 660]; // column starts: Date, Time, Matchup, Team, Player, Status, Reason
const cell = (x, y, text) => `BT\n/F1 -9 Tf\n${text.split(' ').map((w, i) => `${i ? '30 0' : `${x} ${y}`} Td (${w.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj`).join('\n')}\nET`;
const row = (y, cells) => cells.map((c, i) => (c ? cell(X[i], y, c) : '')).filter(Boolean).join('\n');
const page = [
  'q\n1 0 0 -1 0 595.35 cm -100 Tz',
  'BT\n/F0 -22 Tf\n288.1306 62.0094 Td (Injury) Tj\n66.5049 0 Td (Report:) Tj\n82.7041 0 Td (10/24/26) Tj\nET',
  row(100, ['Game Date', 'Game Time', 'Matchup', 'Team', 'Player Name', 'Current Status', 'Reason']),
  row(115, ['10/24/2026', '07:30 (ET)', 'NYK@BOS', 'New York Knicks', 'Brunson, Jalen', 'Questionable', 'Injury/Illness - Left Ankle;']),
  row(125, ['', '', '', '', '', '', 'Sprain']),
  row(135, ['', '', '', '', 'Hart, Josh', 'Out', 'Injury/Illness - Right Knee']),
  row(145, ['', '', '', 'Boston Celtics', 'Tatum, Jayson', 'Available', 'Injury/Illness - Achilles']),
  row(155, ['', '', '', '', 'Porzingis, Kristaps', 'Doubtful', 'Illness']),
  row(165, ['', '', 'MIA@CHA', 'Miami Heat', '', '', 'NOT YET SUBMITTED']),
  row(175, ['', '', '', 'Charlotte Hornets', 'Ball, LaMelo', 'Probable', 'Injury/Illness - Right Ankle']),
  'BT\n/F1 -9 Tf\n380 580 Td (Page) Tj\n30 0 Td (1) Tj\n30 0 Td (of) Tj\n30 0 Td (1) Tj\nET',
  'Q',
].join('\n');

test('NBA injury report: the latest PDF from the page, its words read in place, rows and columns rebuilt', () => {
  const html = '<a href="https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-24_02_45AM.pdf">x</a> <a href="https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-23_05_30PM.pdf">y</a> <a href="https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-24_01_00PM.pdf">z</a>';
  const links = reportLinks(html);
  assert.equal(links.length, 3);
  assert.equal(latestReport(links), 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-10-24_01_00PM.pdf');
  assert.equal(new Date(reportTime(links[0])).toISOString(), '2026-10-24T06:45:00.000Z'); // 2:45 am EDT
  // A tiny PDF: one deflated content stream.
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj << /Length 9 /Filter /FlateDecode >>\nstream\n', 'latin1'), deflateSync(Buffer.from(page, 'latin1')), Buffer.from('\nendstream\nendobj\n', 'latin1')]);
  const [content] = pdfStreams(pdf, inflateSync);
  const items = textItems(content);
  assert.deepEqual(items.slice(0, 3).map((i) => i.s), ['Injury', 'Report:', '10/24/26']);
  const entries = parseReport([textRows(items)]);
  assert.deepEqual(entries.map((x) => [x.team, x.player, x.status]), [
    ['New York Knicks', 'Jalen Brunson', 'Questionable'], ['New York Knicks', 'Josh Hart', 'Out'],
    ['Boston Celtics', 'Jayson Tatum', 'Available'], ['Boston Celtics', 'Kristaps Porzingis', 'Doubtful'],
    ['Charlotte Hornets', 'LaMelo Ball', 'Probable'],
  ]);
  assert.equal(entries[0].reason, 'Injury/Illness - Left Ankle; Sprain', 'a wrapped reason joins its row');
  assert.equal(entries[0].matchup, 'NYK@BOS');
  assert.equal(entries[4].matchup, 'MIA@CHA');
});

test('NBA injury report onto a game: the league\'s status wins, missing players are added, "available" ones leave', () => {
  const e = { home: 'Boston Celtics', away: 'New York Knicks', injuries: { home: [{ id: '1', name: 'Jayson Tatum', status: 'Out' }], away: [{ id: '2', name: 'Jalen Brunson', status: 'Day-To-Day' }] } };
  const entries = [
    { team: 'New York Knicks', player: 'Jalen Brunson', status: 'Questionable', reason: 'Ankle' },
    { team: 'New York Knicks', player: 'Josh Hart', status: 'Out', reason: 'Knee' },
    { team: 'Boston Celtics', player: 'Jayson Tatum', status: 'Available', reason: '' },
    { team: 'Miami Heat', player: 'Someone Else', status: 'Out', reason: '' },
  ];
  assert.equal(applyOfficial(e, entries, (n) => (n === 'Josh Hart' ? '3' : null)), 3);
  assert.deepEqual(e.injuries.away.map((x) => [x.id, x.name, x.status, x.official]), [['2', 'Jalen Brunson', 'Questionable', true], ['3', 'Josh Hart', 'Out', true]]);
  assert.deepEqual(e.injuries.home, [], 'cleared to play: off the list');
});
