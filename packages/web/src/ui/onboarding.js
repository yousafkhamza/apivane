// Phone-style first run: splash (vane swings and settles) -> 6 short steps. Skip on every step.
// Shown once per browser (apivane.onboarded); replay from Settings.
import { $, LS } from '../dom.js';
import { autosaveOn } from '../state.js';
import { engineChoices } from './dialogs.js';

export const STEPS = 6;
let step = 0;
const sysDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

function stepHtml(i, ctx) {
  const theme = LS.get('theme', 'system');
  const choice = (act, k, ic, title, sub, on) => `<button class="choice" data-act="${act}" data-k="${k}" aria-pressed="${on}"><span class="ic">${ic}</span><strong>${title}</strong><small>${sub}</small></button>`;
  switch (i) {
    case 0: return `<h1 id="stepTitle" tabindex="-1">Test any API,<br>right from your browser.</h1><p class="lead">Send requests, check answers, catch security issues and keep everything in git. Free, no account.</p>
      <div class="tips"><div class="tip"><span class="ic">↗</span><div><b>Send &amp; inspect</b><small>JSON, headers, timing, cURL export</small></div></div>
      <div class="tip"><span class="ic">✓</span><div><b>Tests without code</b><small>The same checks run in GitHub Actions</small></div></div>
      <div class="tip"><span class="ic">⛨</span><div><b>Security checks built in</b><small>Headers, CORS, leaked secrets, unsafe URLs</small></div></div></div>`;
    case 1: return `<h1 id="stepTitle" tabindex="-1">How should it look?</h1><p class="lead">By default ApiVane follows your phone or laptop. Change it any time in Settings.</p><div class="tips">
      ${choice('tour-theme', 'system', '◐', 'Match my device', `Right now: ${sysDark() ? 'dark' : 'light'}`, theme === 'system')}
      ${choice('tour-theme', 'light', '☀', 'Light', 'Warm paper tones', theme === 'light')}
      ${choice('tour-theme', 'dark', '☾', 'Dark', 'Easy on the eyes at night', theme === 'dark')}</div>`;
    case 2: return `<h1 id="stepTitle" tabindex="-1">Who sends your requests?</h1><p class="lead">Browsers block many API calls from websites. Start simple — switch any time from the top bar.</p><div class="tips">${engineChoices()}</div>`;
    case 3: return `<h1 id="stepTitle" tabindex="-1">Keep your work</h1><p class="lead">No login. Your requests and variables are saved in this browser only.</p><div class="tips">
      ${choice('tour-save', '1', '⟳', 'Save automatically', 'Recommended — every change is kept', autosaveOn())}
      ${choice('tour-save', '0', '⎙', 'I’ll save myself', 'Save button or Ctrl+S. If you forget, we keep a recovery copy and offer it next time.', !autosaveOn())}
      <div class="tip"><span class="ic">⇅</span><div><b>New device or clearing your browser?</b><small>Settings → Export makes a backup file you can import anywhere.</small></div></div></div>`;
    case 4: return `<h1 id="stepTitle" tabindex="-1">Three things to know</h1><div class="tips">
      <div class="tip"><span class="ic">1</span><div><b>Pick a request, press Send</b><small><span class="mono">Ctrl + Enter</span> sends · <span class="mono">Ctrl + K</span> searches · <span class="mono">Ctrl + S</span> saves</small></div></div>
      <div class="tip"><span class="ic">2</span><div><b>Use <span class="var">{{variables}}</span></b><small>Set them per environment, or save them from a response (like a login token)</small></div></div>
      <div class="tip"><span class="ic">3</span><div><b>Check the Tests and Security tabs</b><small>Every response is checked automatically</small></div></div></div>`;
    default: return `<h1 id="stepTitle" tabindex="-1">You’re all set.</h1><p class="lead">Start with a free public API — no keys needed — or open your library.</p><div class="tips">
      ${ctx.weather ? choice('tour-finish', ctx.weather, '🌤', 'Try the Dubai weather API', 'Open-Meteo · live wind direction', false) : ''}
      ${ctx.login ? choice('tour-finish', ctx.login, '🔑', 'Try a login flow', 'DummyJSON · save a token, reuse it', false) : ''}
      ${ctx.canInstall ? choice('install', '', '⤓', 'Install ApiVane as an app', 'Own window, starts faster, works offline', false) : ''}</div>`;
  }
}

let ctxFn = () => ({});
export function startTour(getCtx) {
  ctxFn = getCtx;
  const boot = $('#boot'), splash = $('#splash'), steps = $('#steps');
  boot.hidden = false;
  steps.classList.remove('on');
  splash.style.display = '';
  const quick = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => { splash.style.display = 'none'; steps.classList.add('on'); goStep(0); }, quick ? 0 : 1900);
}
export function goStep(i) {
  step = Math.max(0, Math.min(STEPS - 1, i));
  $('#stepBody').innerHTML = `<section class="step">${stepHtml(step, ctxFn())}</section>`;
  $('#dots').innerHTML = Array.from({ length: STEPS }, (_, k) => `<i class="${k === step ? 'on' : ''}"></i>`).join('');
  $('#tourBack').style.visibility = step ? 'visible' : 'hidden';
  $('#tourNext').textContent = step === STEPS - 1 ? 'Open my library' : step ? 'Next' : 'Get started';
  $('[data-act="tour-skip"]').style.visibility = step === STEPS - 1 ? 'hidden' : 'visible';
  $('#stepTitle')?.focus();
}
export const tourNext = () => (step < STEPS - 1 ? (goStep(step + 1), false) : true);
export const tourBack = () => goStep(step - 1);
export const rerenderStep = () => goStep(step);
export function endTour() { LS.set('onboarded', '1'); $('#boot').hidden = true; }
export const tourOpen = () => !$('#boot').hidden;
