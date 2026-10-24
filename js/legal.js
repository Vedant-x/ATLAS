// Terms, privacy and responsible-gambling pages, plus the 18+ notice shown on a first visit.
// Plain-language templates: have them reviewed for the countries you operate in before charging money.
const UPDATED = '23 October 2026';
const page = (title, kicker, body) => ({
  mode: 'other', accent: '#d2ff00', title,
  html: `<section class="hero small"><p class="kicker reveal">${kicker}</p><h1>${title.toUpperCase()}</h1></section>
    <article class="legal panel reveal">${body}<p class="muted">Last updated ${UPDATED}.</p></article>`,
});

export const legalViews = {
  terms() {
    return page('Terms', 'USING ATLAS', `
      <h3>What ATLAS is</h3>
      <p>ATLAS is an information and analysis service about sports events. It shows fixtures, prices published by
      third parties, probability estimates from statistical models, and an AI assistant. ATLAS does not take bets,
      hold funds or act as a bookmaker.</p>
      <h3>No guarantees</h3>
      <p>Every probability, "edge", slip and assistant answer is an estimate and can be wrong. Data comes from
      third-party sources that may be late, incomplete or incorrect. Nothing on ATLAS is financial advice or a
      promise of any result. You alone decide whether to bet, and you are responsible for your decisions.</p>
      <h3>Who may use it</h3>
      <p>You must be 18 or older (or the legal gambling age where you live, if higher), and you may use ATLAS only
      where sports betting information is lawful. Check the law in your country.</p>
      <h3>Fair use</h3>
      <p>Don't scrape, overload, resell or copy the service, or use it to break the law or a bookmaker's rules.</p>
      <h3>Liability</h3>
      <p>ATLAS is provided "as is". To the extent the law allows, ATLAS is not liable for losses arising from use of
      the service, including betting losses.</p>
      <h3>Changes</h3>
      <p>These terms may change; the date below shows the latest version.</p>`);
  },
  privacy() {
    return page('Privacy', 'YOUR DATA', `
      <h3>No account, no tracking</h3>
      <p>ATLAS has no sign-up and runs no analytics or advertising trackers.</p>
      <h3>Stored only in your browser</h3>
      <p>Your bet slip, filters (minimum odds, sports), assistant chat, chosen character and display settings are
      saved in your browser's local storage on your device. They never reach ATLAS servers. Clear your browser's
      site data to delete them.</p>
      <h3>The AI assistant</h3>
      <p>The assistant answers from ATLAS's own rules, in your browser. An on-device AI model is off until you switch
      it on; it then downloads once (about 1 GB on a phone, 2 GB on a computer) and runs on your device, so your
      questions stay there. If a hosted AI service is enabled in the future, your question and the related match data
      would be sent to it to produce the answer; this page will say so.</p>
      <h3>Third parties your browser contacts</h3>
      <p>To show live data your browser loads public information from ESPN, FotMob and the MLB Stats API, fonts from
      Google Fonts, and (only if you switch the on-device AI on) the AI model files from Hugging Face. Those services receive your IP address as part of a
      normal web request, under their own privacy policies.</p>
      <h3>Contact</h3>
      <p>Questions about privacy: open an issue on the project's GitHub page.</p>`);
  },
  responsible() {
    return page('Bet responsibly', 'STAY IN CONTROL', `
      <p>Betting should be entertainment, never a way to make money or recover losses. Most bets lose:
      bookmaker prices include a margin, and none of ATLAS's pick lists has made money over its record so far
      (the Results page shows every one).</p>
      <h3>Is it legal where you are?</h3>
      <p>In India the law on betting is set state by state, and several states ban online betting outright.
      Elsewhere the rules differ by country. Check the law where you live before you bet; ATLAS is analysis
      only and takes no bets.</p>
      <h3>Keep it safe</h3>
      <ul><li>Set a budget you can afford to lose, and a time limit, before you start.</li>
      <li>Never chase losses, and never bet when upset, drunk, tired or under pressure.</li>
      <li>Use your bookmaker's deposit limits, cool-off periods and self-exclusion (Stake and most others have
      them in the account's responsible gambling settings).</li>
      <li>Take breaks. If it stops being fun, stop.</li></ul>
      <h3>Warning signs</h3>
      <ul><li>Betting more to win back what you lost, or hiding how much you bet.</li>
      <li>Borrowing, or using money meant for rent, bills or family, to bet.</li>
      <li>Feeling restless or irritable when you try to cut down.</li></ul>
      <h3>Get help (free, confidential)</h3>
      <ul class="rg-links"><li>India: <b>Tele-MANAS</b>, the government's 24-hour mental health line: <a href="tel:14416">14416</a> or <a href="tel:18008914416">1-800-891-4416</a></li>
      <li>India: <b>iCall</b> (TISS), <a href="tel:+919152987821">+91 91529 87821</a>, <a href="https://icallhelpline.org" target="_blank" rel="noopener noreferrer">icallhelpline.org</a></li>
      <li>India: <b>Vandrevala Foundation</b>, 24 hours, call or WhatsApp <a href="tel:+919999666555">+91 99996 66555</a></li>
      <li>Worldwide, online: <b>Gambling Therapy</b>, <a href="https://www.gamblingtherapy.org" target="_blank" rel="noopener noreferrer">gamblingtherapy.org</a></li>
      <li>UK: GamCare, 0808 8020 133, <a href="https://www.gamcare.org.uk" target="_blank" rel="noopener noreferrer">gamcare.org.uk</a> · self-exclusion: <a href="https://www.gamstop.co.uk" target="_blank" rel="noopener noreferrer">gamstop.co.uk</a></li>
      <li>USA: 1-800-GAMBLER, <a href="https://www.ncpgambling.org" target="_blank" rel="noopener noreferrer">ncpgambling.org</a></li>
      <li>Australia: Gambling Help Online, 1800 858 858, <a href="https://www.gamblinghelponline.org.au" target="_blank" rel="noopener noreferrer">gamblinghelponline.org.au</a></li></ul>`);
  },
};

// First visit: the year of birth, not a single "I'm 18" tap. Under 18 (by the year given) is turned
// away, and the answer is kept for a day so it cannot simply be tapped again. Remembered in this
// browser once passed. Returns true when the check is on screen.
export const AGE = 18;
// By year alone; someone turning 18 this year confirms with the box below.
export const oldEnough = (year, now = new Date()) => Number.isInteger(year) && year >= 1900 && now.getFullYear() - year >= AGE;
const NO_KEY = 'atlas-age-no';
export function ageGate() {
  let ok = false, refused = false;
  try { ok = localStorage.getItem('atlas-age-ok') === '1'; refused = Number(localStorage.getItem(NO_KEY)) > Date.now() - 864e5; } catch { /* storage blocked: ask each visit */ }
  if (ok) return false;
  const d = document.createElement('div');
  d.className = 'age-gate';
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-modal', 'true');
  d.setAttribute('aria-label', 'Age check');
  const turnedAway = `<div class="age-card"><b>18+</b><h2>ATLAS is for adults only</h2><p>Come back when you are 18. If betting is already a worry, these people can help, free and in confidence:</p>
    <p><a href="tel:14416">Tele-MANAS 14416</a> · <a href="https://www.gamblingtherapy.org" rel="noopener noreferrer">gamblingtherapy.org</a></p></div>`;
  d.innerHTML = refused ? turnedAway : `<form class="age-card" data-age-form novalidate><b>18+</b><h2>How old are you?</h2>
    <p>ATLAS shows sports betting analysis, for adults only (18, or the legal age where you live if higher).
    Estimates are never guarantees: bet only what you can afford to lose.</p>
    <label class="age-year"><span>Year of birth</span><input name="year" inputmode="numeric" autocomplete="bday-year" maxlength="4" pattern="[0-9]{4}" placeholder="YYYY" required /></label>
    <label class="age-confirm"><input type="checkbox" name="confirm" required /> <span>I am 18 or older and betting is legal where I live</span></label>
    <p class="age-err" role="alert" hidden></p>
    <div class="age-btns"><button class="btn" type="submit">Continue</button></div>
    <small><a href="#/terms" data-age="read">Terms</a> · <a href="#/privacy" data-age="read">Privacy</a> · <a href="#/responsible" data-age="read">Bet responsibly</a></small></form>`;
  document.body.append(d);
  d.addEventListener('click', (e) => { if (e.target.closest('[data-age="read"]')) d.classList.add('peek'); }); // read the page; the gate returns on reload
  d.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target, year = Number(f.year.value), err = f.querySelector('.age-err');
    const say = (m) => { err.textContent = m; err.hidden = false; };
    if (!/^\d{4}$/.test(f.year.value) || year < 1900 || year > new Date().getFullYear()) return say('Enter the year you were born, four digits.');
    if (!oldEnough(year)) { try { localStorage.setItem(NO_KEY, String(Date.now())); } catch { /* ignore */ } d.innerHTML = turnedAway; return; }
    if (!f.confirm.checked) return say('Tick the box to confirm.');
    try { localStorage.setItem('atlas-age-ok', '1'); } catch { /* ignore */ }
    d.remove();
  });
  setTimeout(() => d.querySelector('input[name="year"]')?.focus(), 50);
  return true;
}
