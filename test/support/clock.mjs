// Shifts the clock by SHIFT_H hours for a test run (node --import ./test/support/clock.mjs), so CI can
// run the unit tests at every hour of the day: the live build runs them first, and a test that only
// passes at some hours would stop the site from publishing at the others.
const off = Number(process.env.SHIFT_H || 0) * 36e5;
const RealDate = Date;
class ShiftedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + off); else super(...a); }
  static now() { return RealDate.now() + off; }
}
globalThis.Date = ShiftedDate;
