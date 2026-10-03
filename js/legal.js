// Terms, privacy and responsible-gambling pages, plus the 18+ notice shown on a first visit.
// Plain-language templates: have them reviewed for the countries you operate in before charging money.
const UPDATED = '3 October 2026';
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
      <p>The assistant's AI model is downloaded to your device and runs there, so your questions stay on your device.
      If a hosted AI service is enabled in the future, your question and the related match data would be sent to it
      to produce the answer; this page will say so.</p>
      <h3>Third parties your browser contacts</h3>
      <p>To show live data your browser loads public information from ESPN, FotMob and the MLB Stats API, fonts from
      Google Fonts, and the AI model files from Hugging Face. Those services receive your IP address as part of a
      normal web request, under their own privacy policies.</p>
      <h3>Contact</h3>
      <p>Questions about privacy: open an issue on the project's GitHub page.</p>`);
  },
  responsible() {
    return page('Bet responsibly', 'STAY IN CONTROL', `
      <p>Betting should be entertainment, never a way to make money or recover losses. Most bets lose: bookmaker
      prices include a margin, which ATLAS shows as negative edge.</p>
      <h3>Keep it safe</h3>
      <ul><li>Set a budget you can afford to lose, and a time limit, before you start.</li>
      <li>Never chase losses or bet when upset, drunk or under pressure.</li>
      <li>Use deposit limits, time-outs and self-exclusion tools offered by your bookmaker.</li>
      <li>Take breaks. If it stops being fun, stop.</li></ul>
      <h3>Get help (free, confidential)</h3>
      <ul><li>UK: GamCare, 0808 8020 133, <a href="https://www.gamcare.org.uk" target="_blank" rel="noopener noreferrer">gamcare.org.uk</a> · self-exclusion: <a href="https://www.gamstop.co.uk" target="_blank" rel="noopener noreferrer">gamstop.co.uk</a></li>
      <li>USA: 1-800-GAMBLER, <a href="https://www.ncpgambling.org" target="_blank" rel="noopener noreferrer">ncpgambling.org</a></li>
      <li>India: <a href="https://www.icallhelpline.org" target="_blank" rel="noopener noreferrer">iCall</a>, 9152987821</li>
      <li>Australia: Gambling Help Online, 1800 858 858, <a href="https://www.gamblinghelponline.org.au" target="_blank" rel="noopener noreferrer">gamblinghelponline.org.au</a></li>
      <li>Worldwide: <a href="https://www.gamblingtherapy.org" target="_blank" rel="noopener noreferrer">gamblingtherapy.org</a></li></ul>`);
  },
};

// First visit: confirm age before showing betting content (remembered in this browser).
export function ageGate() {
  let ok = false;
  try { ok = localStorage.getItem('atlas-age-ok') === '1'; } catch { /* storage blocked: ask each visit */ }
  if (ok) return;
  const d = document.createElement('div');
  d.className = 'age-gate';
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-modal', 'true');
  d.innerHTML = `<div class="age-card"><b>18+</b><h2>Are you 18 or older?</h2>
    <p>ATLAS shows sports betting analysis. You must be 18 or over (or the legal age where you live) to use it.
    Estimates are never guarantees: bet only what you can afford to lose.</p>
    <div class="age-btns"><button class="btn" data-age="yes">I'm 18 or older</button><a class="btn-ghost" href="https://www.gamblingtherapy.org" rel="noopener noreferrer">I'm under 18</a></div>
    <small><a href="#/terms" data-age="read">Terms</a> · <a href="#/privacy" data-age="read">Privacy</a> · <a href="#/responsible" data-age="read">Bet responsibly</a></small></div>`;
  document.body.append(d);
  d.addEventListener('click', (e) => {
    const t = e.target.closest('[data-age]');
    if (!t) return;
    if (t.dataset.age === 'yes') { try { localStorage.setItem('atlas-age-ok', '1'); } catch { /* ignore */ } d.remove(); }
    if (t.dataset.age === 'read') d.classList.add('peek'); // let them read the page, gate returns on reload
  });
  setTimeout(() => d.querySelector('[data-age="yes"]')?.focus(), 50);
}
