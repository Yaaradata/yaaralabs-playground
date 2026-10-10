import { exerciseBrandHtml } from '../../../exerciseHeaderIcons';
import { bindHostFullscreen } from '../../../fullscreen';
import { THEME_TOGGLE_HTML, bindExerciseTheme } from '../../../theme';
import {
  CELLS,
  CHALLENGES,
  INNER,
  NAME,
  ORDER,
  PTS,
  SHORT,
  type ChallengeDef,
  type ChallengeKey,
  type Counts,
  type Piece,
  type Scenario,
  RAPID_CHOICES,
  RAPID_QUESTIONS,
  challengeByKey,
  createScenario,
  f2,
  fmtN,
  isRapidMetric,
  makeOpts,
  parseNum,
  placementOk,
  rapidLabel,
  starsOf,
  type RapidMetric,
} from './logic';

export interface MountOptions {
  sessionId: string;
  projectId: string;
  onComplete?: () => void;
}

interface CellState {
  val: string;
  src: string | null;
  mark: 'ok' | 'bad' | 'shown' | null;
}

interface SlotFill {
  t: Piece;
  l: string;
}

interface ChallengeState {
  slots: Record<string, (SlotFill | null)[]>;
  peek: boolean;
  picks: string[];
  pts: number;
  solved: boolean;
  opts: string[] | null;
}

interface DragState {
  kind: 'piece' | 'story';
  t?: string;
  label?: string;
  val?: number;
  src?: string;
  fromCell?: string | null;
  el: HTMLElement | null;
  x: number;
  y: number;
  moved: boolean;
  id: number;
  ghost?: HTMLElement;
}

type Sel = { kind: 'story'; id: string } | { kind: 'piece'; t: string; label: string } | null;

const STAR =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>';
const BOLT =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 10-14h-7z"/></svg>';
const RAPID_AT = CHALLENGES.length;
const RESULT_AT = CHALLENGES.length + 1;
const SCORE_MAX = PTS.start * (CHALLENGES.length + 2);
const STAR_MAX = 3 * (CHALLENGES.length + 2);

interface RapidState {
  misses: RapidMetric[];
  cursor: number;
  pts: number;
  solved: boolean;
}

const TEMPLATE = `<header>
  ${exerciseBrandHtml(3, 'Exercise - 3 : Confusion matrix')}
  <div class="hud" aria-label="Your score">
    <div class="h" title="Points from the matrix and every metric you solve"><small>Score</small><b id="hScore">0</b></div>
    <div class="h star" title="Stars earned. Up to 3 per challenge"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg><b id="hStars">0</b></div>
    <div class="h fire" id="hFire" title="Streak: right moves in a row"><svg width="14" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 1.5s1 3.4-1.4 6.3C10 10.4 7 11.7 7 16a5 5 0 0 0 10 0c0-2-.8-3.3-1.6-4.4.2 1.5-.3 2.7-1.4 3.1.6-3.4-.4-7.5-.5-13.2z"/></svg><b id="hStreak">0</b></div>
  </div>
  ${THEME_TOGGLE_HTML}
  <button type="button" class="icon" id="fsBtn" title="Full screen" aria-label="Full screen"></button>
</header>
<main>
  <section class="card" id="cScen" aria-label="The scenario">
    <div class="chead"><span class="n">1</span><div class="ct"><b>The scenario</b><span>Read it, then move its numbers into the matrix</span></div>
      <button type="button" class="mini li" id="newBtn" title="A new random scenario with new numbers">New scenario</button></div>
    <div class="scen-title"><span class="tag" id="scTag"></span><b id="scName" style="font-size:14px"></b></div>
    <p class="story" id="story"></p>
  </section>
  <section class="card" id="cMatrix" aria-label="The confusion matrix">
    <div class="chead"><span class="n">2</span><div class="ct"><b>Confusion matrix</b><span class="legend"><span><b style="color:var(--tp)">TP</b> true positive</span><span><b style="color:var(--fn)">FN</b> false negative</span><span><b style="color:var(--fp)">FP</b> false positive</span><span><b style="color:var(--tn)">TN</b> true negative</span></span></div>
      <button type="button" class="mini" id="clrBtn">Clear</button></div>
    <div class="mxwrap">
      <div class="mx" id="mx">
        <div class="axis top">Model predicted</div>
        <div class="axis side">Actually</div>
        <div class="corner" style="grid-column:2;grid-row:2"><span>Positive class</span><b id="posName"></b></div>
        <div class="ch" style="grid-column:3;grid-row:2" id="hPP"></div>
        <div class="ch" style="grid-column:4;grid-row:2" id="hPN"></div>
        <div class="ch tot" style="grid-column:5;grid-row:2">Total</div>
        <div class="rh" style="grid-column:2;grid-row:3" id="hAP"></div>
        <div class="rh" style="grid-column:2;grid-row:4" id="hAN"></div>
        <div class="rh tot" style="grid-column:2;grid-row:5">Total</div>
      </div>
    </div>
    <div class="mxfoot">
      <span class="status" id="mxStatus" aria-live="polite"></span>
      <button type="button" class="mini am" id="revealMx" hidden>Show the matrix</button>
    </div>
    <button type="button" class="go" id="checkMx">Check the matrix</button>
  </section>
  <section class="card locked" id="cMetrics" aria-label="Metric challenges">
    <div class="chead"><span class="n">3</span><div class="ct"><b>Metric challenges</b><span>Six formulas, then a rapid-fire round: which metric fits?</span></div></div>
    <div class="map" id="map" aria-label="Challenges"></div>
    <div class="stage" id="stage"></div>
    <div class="navbar">
      <button type="button" class="circ" id="prevBtn" aria-label="Previous challenge" title="Previous challenge"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
      <span class="navmsg" id="navMsg" aria-live="polite"></span>
      <button type="button" class="circ" id="nextBtn" aria-label="Next challenge" title="Next challenge"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
  </section>
</main>`;

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
}
function fr(a: string, b: string): string {
  return `<span class="fr"><span class="nu">${a}</span><span class="de">${b}</span></span>`;
}
function par(h: string): string {
  return `<span class="grp"><span class="pn">(</span>${h}<span class="pn">)</span></span>`;
}
function sqrt(h: string): string {
  return `<span class="sq"><span class="rad">√</span><span class="un">${h}</span></span>`;
}
function T(...parts: string[]): string {
  return parts
    .map((x) => (NAME[x] ? `<span class="t ${x}">${NAME[x]}</span>` : `<span class="o">${x}</span>`))
    .join('');
}
function lettersHtml(k: ChallengeKey): string {
  switch (k) {
    case 'acc':
      return fr(T('tp', '+', 'tn'), T('tp', '+', 'tn', '+', 'fp', '+', 'fn'));
    case 'prec':
      return fr(T('tp'), T('tp', '+', 'fp'));
    case 'rec':
      return fr(T('tp'), T('tp', '+', 'fn'));
    case 'spec':
      return fr(T('tn'), T('tn', '+', 'fp'));
    case 'f1':
      return `<span class="k2">2</span><span class="o">×</span>${fr(T('P', '×', 'R'), T('P', '+', 'R'))}`;
    case 'mcc':
      return fr(
        `${par(T('tp', '×', 'tn'))}<span class="o">−</span>${par(T('fp', '×', 'fn'))}`,
        sqrt(
          [
            ['tp', 'fp'],
            ['tp', 'fn'],
            ['tn', 'fp'],
            ['tn', 'fn'],
          ]
            .map(([a, b]) => par(T(a, '+', b)))
            .join(''),
        ),
      );
    default: {
      const _never: never = k;
      return _never;
    }
  }
}

export function mountExercise3(host: HTMLElement, opts: MountOptions): () => void {
  void opts.sessionId;
  void opts.projectId;
  const { onComplete } = opts;
  host.classList.add('is-booting');
  host.innerHTML = TEMPLATE;
  const unbindTheme = bindExerciseTheme(host);
  const unbindFs = bindHostFullscreen(host, host.querySelector('#fsBtn'));

  const $ = <T extends Element = HTMLElement>(s: string) => host.querySelector(s) as T | null;
  const $$ = <T extends Element = HTMLElement>(s: string) => [...host.querySelectorAll<T>(s)];

  let SC: Scenario | null = null;
  const CELL: Record<string, CellState> = {};
  let MX = { done: false, revealed: false, tries: 0, pts: PTS.start };
  let G: Record<ChallengeKey, ChallengeState> = blankChallenges();
  let RF: RapidState = blankRapid();
  let rapidBusy = false;
  let STREAK = 0;
  let SEL: Sel = null;
  let VIEW = 0;
  let LAST: number | null = null;
  let DIR: 'next' | 'prev' = 'next';
  let DRAG: DragState | null = null;
  let finished = false;
  let alive = true;
  const timers = new Set<number>();

  function later(fn: () => void, ms: number) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (alive) fn();
    }, ms);
    timers.add(id);
  }

  function blankChallenges(): Record<ChallengeKey, ChallengeState> {
    const next = {} as Record<ChallengeKey, ChallengeState>;
    CHALLENGES.forEach((c) => {
      const slots: Record<string, (SlotFill | null)[]> = {};
      Object.entries(c.bags).forEach(([b, n]) => {
        slots[b] = Array.from({ length: n }, () => null);
      });
      next[c.k] = { slots, peek: false, picks: [], pts: PTS.start, solved: false, opts: null };
    });
    return next;
  }

  function blankRapid(): RapidState {
    return { misses: [], cursor: 0, pts: PTS.start, solved: false };
  }

  function bag(c: ChallengeDef, b: string, op?: string): string {
    return G[c.k].slots[b]
      .map((s, i) =>
        s
          ? `<span class="slot on ${s.t}" title="${NAME[s.t] || s.t}">${esc(s.l)}</span>`
          : `<button type="button" class="slot" data-k="${c.k}" data-b="${b}" data-i="${i}" aria-label="Empty box in ${esc(c.name)}">?</button>`,
      )
      .join(op ? `<span class="o">${op}</span>` : '');
  }

  function formulaHtml(c: ChallengeDef): string {
    switch (c.k) {
      case 'acc':
        return fr(bag(c, 'A', '+'), bag(c, 'B', '+'));
      case 'prec':
      case 'rec':
      case 'spec':
        return fr(bag(c, 'A'), bag(c, 'B', '+'));
      case 'f1':
        return `<span class="k2">2</span><span class="o">×</span>${fr(bag(c, 'A', '×'), bag(c, 'B', '+'))}`;
      case 'mcc':
        return fr(
          `${par(bag(c, 'A', '×'))}<span class="o">−</span>${par(bag(c, 'B', '×'))}`,
          sqrt(['C', 'D', 'E', 'F'].map((b) => par(bag(c, b, '+'))).join('')),
        );
      default: {
        const _never: never = c.k;
        return _never;
      }
    }
  }

  function counts(): Counts {
    if (!SC) throw new Error('No scenario');
    return SC.v;
  }

  function newScenario() {
    SC = createScenario(Math.random, SC?.dom.k);
    ORDER.forEach((k) => {
      CELL[k] = { val: '', src: null, mark: null };
    });
    MX = { done: false, revealed: false, tries: 0, pts: PTS.start };
    G = blankChallenges();
    RF = blankRapid();
    rapidBusy = false;
    SEL = null;
    STREAK = 0;
    VIEW = 0;
    LAST = null;
    $('#cMetrics')?.classList.add('locked');
    setStatus('', '');
    renderScenario();
    renderMatrix();
    renderChallenges();
    renderHud();
  }

  function totals() {
    let s = 0;
    let st = 0;
    if (MX.done) {
      s += MX.pts;
      st += starsOf(MX.pts);
    }
    CHALLENGES.forEach((c) => {
      const g = G[c.k];
      if (g.solved) {
        s += g.pts;
        st += starsOf(g.pts);
      }
    });
    if (RF.solved) {
      s += RF.pts;
      st += starsOf(RF.pts);
    }
    return { s, st };
  }

  function renderHud(bump?: string[]) {
    const { s, st } = totals();
    const score = $('#hScore');
    const stars = $('#hStars');
    const streak = $('#hStreak');
    if (score) score.textContent = String(s);
    if (stars) stars.textContent = String(st);
    if (streak) streak.textContent = String(STREAK);
    $('#hFire')?.classList.toggle('hot', STREAK >= 3);
    bump?.forEach((id) => {
      const el = $(id)?.parentElement;
      if (!el) return;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    });
  }

  function hit() {
    STREAK += 1;
    renderHud(['#hStreak']);
  }
  function miss() {
    STREAK = 0;
    renderHud();
  }
  function lose(k: ChallengeKey, n: number) {
    const g = G[k];
    g.pts = Math.max(PTS.min, g.pts - n);
    syncPot(k);
  }
  function syncPot(k: ChallengeKey) {
    const g = G[k];
    const stg = host.querySelector(`.stg[data-k="${k}"]`);
    if (!stg) return;
    const b = stg.querySelector('.pot b');
    if (b) b.textContent = String(g.pts);
    const n = starsOf(g.pts);
    stg.querySelectorAll('.pot .stars svg').forEach((svg, i) => svg.classList.toggle('on', i < n));
  }

  function fly(x: number, y: number, text: string, neg?: boolean) {
    const el = document.createElement('div');
    el.className = `fly${neg ? ' neg' : ''}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    host.appendChild(el);
    later(() => el.remove(), 1000);
  }
  function flyAt(el: Element, text: string, neg?: boolean) {
    const r = el.getBoundingClientRect();
    fly(r.left + r.width / 2, r.top, text, neg);
  }

  function renderScenario() {
    if (!SC) return;
    const d = SC.dom;
    const tag = $('#scTag');
    const name = $('#scName');
    if (tag) tag.textContent = d.tag;
    if (name) name.textContent = d.name;
    const story = $('#story');
    if (story) {
      story.innerHTML = SC.lines
        .map((l, i) => {
          const body =
            l.val == null
              ? esc(l.html)
              : esc(l.html).replace(
                  '{v}',
                  `<button type="button" class="num" data-id="f${i}" data-v="${l.val}" aria-label="${fmtN(l.val)}. Drag onto a cell, or press Enter then pick a cell">${fmtN(l.val)}</button>`,
                );
          return `<span class="s">${body}</span>`;
        })
        .join(' ');
    }
    const pos = $('#posName');
    if (pos) pos.textContent = d.pos;
    const hpp = $('#hPP');
    const hpn = $('#hPN');
    const hap = $('#hAP');
    const han = $('#hAN');
    if (hpp) hpp.textContent = d.hPP;
    if (hpn) hpn.textContent = d.hPN;
    if (hap) hap.textContent = d.hAP;
    if (han) han.textContent = d.hAN;
    markSel();
  }

  function markSel() {
    const used = new Set(Object.values(CELL).map((c) => c.src).filter(Boolean));
    $$<HTMLButtonElement>('.num').forEach((b) => {
      b.classList.toggle('used', used.has(b.dataset.id || ''));
      b.classList.toggle('sel', SEL?.kind === 'story' && SEL.id === b.dataset.id);
    });
    $('#mx')?.classList.toggle('target', SEL?.kind === 'story');
    $$('.cell.src').forEach((c) => c.classList.toggle('sel', SEL?.kind === 'piece' && SEL.t === c.dataset.c));
    $$('.pc').forEach((c) => c.classList.toggle('sel', SEL?.kind === 'piece' && SEL.t === c.dataset.t));
    $$('.board').forEach((b) => b.classList.toggle('target', SEL?.kind === 'piece'));
  }

  function buildMatrix() {
    const mx = $('#mx');
    if (!mx) return;
    CELLS.forEach((row, ri) =>
      row.forEach((k, ci) => {
        const tot = ri === 2 || ci === 2;
        const el = document.createElement('div');
        el.className = `cell${tot ? ' tot' : ''}`;
        el.dataset.c = k;
        el.style.gridRow = String(ri + 3);
        el.style.gridColumn = String(ci + 3);
        const rowName = ['actually positive', 'actually negative', 'total'][ri];
        const colName = ['predicted positive', 'predicted negative', 'total'][ci];
        const label = tot ? 'Total' : NAME[k];
        el.innerHTML = `${NAME[k] && !tot ? `<span class="tg">${NAME[k]}</span>` : ''}<input inputmode="numeric" autocomplete="off" placeholder="?" aria-label="${label}: ${rowName}, ${colName}"><button type="button" class="clr" tabindex="-1" aria-label="Clear this cell" title="Clear">×</button><span class="mk"></span>`;
        mx.appendChild(el);
      }),
    );
  }

  function renderMatrix() {
    const scenario = SC;
    if (!scenario) return;
    ORDER.forEach((k) => {
      const el = host.querySelector<HTMLElement>(`.cell[data-c="${k}"]`);
      const c = CELL[k];
      if (!el || !c) return;
      const inp = el.querySelector('input');
      const shown = c.val === '' ? '' : fmtN(+c.val);
      if (inp && (document.activeElement !== inp || inp.value.replace(/,/g, '') !== c.val)) inp.value = shown;
      el.classList.toggle('filled', c.val !== '');
      el.classList.toggle('story', !!c.src && !MX.done);
      el.classList.toggle('ok', c.mark === 'ok' && !MX.done);
      el.classList.toggle('bad', c.mark === 'bad');
      el.classList.toggle('shown', c.mark === 'shown');
      const mk = el.querySelector('.mk');
      if (mk) mk.textContent = MX.done ? '' : c.mark === 'ok' ? '✓' : c.mark === 'bad' ? '✗' : '';
      el.classList.toggle('lock', MX.done);
      if (inp) inp.readOnly = MX.done;
      const clr = el.querySelector('.clr');
      if (clr instanceof HTMLElement) clr.hidden = MX.done;
      const src = MX.done && (INNER as string[]).includes(k);
      el.classList.toggle('src', src);
      if (src) {
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', `${NAME[k]} ${fmtN(scenario.v[k])}. Drag into a formula, or press Enter then pick a box`);
        if (inp) inp.tabIndex = -1;
      } else {
        el.removeAttribute('tabindex');
        el.removeAttribute('role');
        el.removeAttribute('aria-label');
        if (inp) inp.tabIndex = 0;
      }
    });
    const ready = MX.done && !CHALLENGES.every((c) => G[c.k].solved);
    $('#mx')?.classList.toggle('ready', ready);
    const check = $<HTMLButtonElement>('#checkMx');
    if (check) {
      check.disabled = MX.done;
      check.textContent = MX.done ? (MX.revealed ? 'Matrix shown' : 'Matrix complete ✓') : 'Check the matrix';
    }
    const reveal = $<HTMLButtonElement>('#revealMx');
    if (reveal) reveal.hidden = MX.done || MX.tries < 2;
    const clrBtn = $<HTMLButtonElement>('#clrBtn');
    if (clrBtn) clrBtn.disabled = MX.done || !ORDER.some((k) => CELL[k]?.val !== '');
    markSel();
  }

  function setStatus(msg: string, kind: '' | 'bad' | 'ok') {
    const el = $('#mxStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = `status${kind ? ` ${kind}` : ''}`;
  }

  function setCell(k: string, val: number | '', src?: string | null) {
    if (MX.done || !k) return;
    if (src) {
      ORDER.forEach((key) => {
        if (key !== k && CELL[key]?.src === src) CELL[key] = { val: '', src: null, mark: null };
      });
    }
    CELL[k] = { val: val === '' ? '' : String(val), src: src || null, mark: null };
    setStatus('', '');
    renderMatrix();
  }

  function checkMatrix() {
    if (!SC) return;
    const empty = ORDER.filter((k) => CELL[k]?.val === '');
    const bad = ORDER.filter((k) => CELL[k]?.val !== '' && parseNum(CELL[k].val) !== SC!.v[k]);
    if (empty.length === ORDER.length) {
      setStatus('The matrix is empty. Move numbers from the story into it first.', 'bad');
      return;
    }
    MX.tries += 1;
    ORDER.forEach((k) => {
      if (CELL[k].val !== '') CELL[k].mark = parseNum(CELL[k].val) === SC!.v[k] ? 'ok' : 'bad';
    });
    const right = ORDER.length - empty.length - bad.length;
    const btn = $('#checkMx');
    if (!empty.length && !bad.length) {
      MX.done = true;
      hit();
      setStatus(`All 9 cells are right. +${MX.pts} points. Now drag its coloured cells into the formulas.`, 'ok');
      if (btn) flyAt(btn, `+${MX.pts}`);
      renderMatrix();
      unlockChallenges();
      renderHud(['#hScore', '#hStars']);
      return;
    }
    if (bad.length) {
      MX.pts = Math.max(PTS.min, MX.pts - PTS.drop * bad.length);
      miss();
      if (btn) flyAt(btn, `−${PTS.drop * bad.length}`, true);
    }
    const rightLabel = right === 1 ? '1 of 9 cells is right.' : `${right} of 9 cells are right.`;
    const badLabel =
      bad.length === 1 ? ' 1 marked ✗ needs another look.' : bad.length ? ` ${bad.length} marked ✗ need another look.` : '';
    const emptyLabel = empty.length === 1 ? ' 1 still empty.' : empty.length ? ` ${empty.length} still empty.` : '';
    setStatus(`${rightLabel}${badLabel}${emptyLabel}`, 'bad');
    renderMatrix();
  }

  function revealMatrix() {
    if (!SC) return;
    ORDER.forEach((k) => {
      const ok = parseNum(CELL[k]?.val || '') === SC!.v[k];
      CELL[k] = { val: String(SC!.v[k]), src: null, mark: ok ? 'ok' : 'shown' };
    });
    MX.done = true;
    MX.revealed = true;
    MX.pts = PTS.min;
    setStatus('Cells outlined in amber were empty or wrong. Now drag the coloured cells into the formulas.', '');
    renderMatrix();
    unlockChallenges();
    renderHud(['#hScore']);
  }

  function reached() {
    const i = CHALLENGES.findIndex((c) => !G[c.k].solved);
    if (i >= 0) return i;
    if (!RF.solved) return RAPID_AT;
    return RESULT_AT;
  }
  function filled(k: ChallengeKey) {
    return Object.values(G[k].slots).every((a) => a.every(Boolean));
  }
  function unlockChallenges() {
    $('#cMetrics')?.classList.remove('locked');
    VIEW = 0;
    LAST = null;
    renderChallenges();
  }

  function piecesHTML(c: ChallengeDef) {
    const items = c.needs
      ? (['P', 'R'] as const).map((t) => ({
          t,
          v: f2(challengeByKey(t === 'P' ? 'prec' : 'rec').value(counts())),
          n: NAME[t],
        }))
      : INNER.map((t) => ({ t, v: fmtN(counts()[t]), n: NAME[t] }));
    return `<div class="dock"><span>Your pieces</span>${items
      .map(
        (x) =>
          `<span class="pc ${x.t}" data-t="${x.t}" data-v="${x.v}" tabindex="0" role="button" aria-label="${x.n} ${x.v}. Drag into a box, or press Enter then pick a box"><small>${x.n}</small>${esc(x.v)}</span>`,
      )
      .join('')}</div>`;
  }

  function starHTML(n: number) {
    return `<span class="stars" aria-label="${n} of 3 stars">${[0, 1, 2]
      .map(
        (i) =>
          `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" class="${i < n ? 'on' : ''}"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>`,
      )
      .join('')}</span>`;
  }

  function renderChallenges() {
    const metrics = $('#cMetrics');
    const locked = metrics?.classList.contains('locked') ?? true;
    const R = reached();
    if (VIEW > R) VIEW = R;
    const map = $('#map');
    if (map) {
      map.innerHTML =
        CHALLENGES.map((c, i) => {
          const g = G[c.k];
          const done = g.solved;
          const cur = !locked && i === R;
          const link = i
            ? `<span class="link ${done || cur ? 'on' : ''}"><i></i></span>`
            : '';
          return `${link}<button type="button" class="lv ${done ? 'done' : ''} ${cur ? 'cur' : ''} ${!locked && VIEW === i ? 'view' : ''}" data-go="${i}" ${locked || i > R ? 'disabled' : ''} aria-label="${esc(c.name)}${done ? ', solved' : ''}"><span class="dot">${done ? '✓' : i + 1}</span><small>${SHORT[c.k]}</small><span class="ms">${done ? [0, 1, 2].map((j) => STAR.replace('<svg', `<svg class="${j < starsOf(g.pts) ? 'on' : ''}"`)).join('') : ''}</span></button>`;
        }).join('') +
        levelButton({
          go: RAPID_AT,
          label: 'Rapid',
          aria: `Rapid fire${RF.solved ? ', solved' : ''}`,
          done: RF.solved,
          cur: !locked && RAPID_AT === R,
          view: !locked && VIEW === RAPID_AT,
          disabled: locked || RAPID_AT > R,
          dot: RF.solved ? '✓' : BOLT,
          stars: RF.solved ? starsOf(RF.pts) : 0,
        }) +
        levelButton({
          go: RESULT_AT,
          label: 'Result',
          aria: 'Results',
          done: R === RESULT_AT,
          cur: !locked && R === RESULT_AT,
          view: !locked && VIEW === RESULT_AT,
          disabled: locked || R < RESULT_AT,
          dot: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zm-1 4v1a2 2 0 0 0 1.2 1.8C7.1 9.2 7 8.6 7 8V7zm11 0v1c0 .6-.1 1.2-.2 1.8A2 2 0 0 0 18 8V7z"/></svg>',
          stars: 0,
          trophy: true,
        });
    }
    const anim = LAST !== VIEW && LAST !== null ? ` in-${DIR}` : '';
    LAST = locked ? null : VIEW;
    let html = '';
    if (locked) {
      html = `<div class="lockcard"><span class="lk"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>
        <b>Complete the matrix to start</b><p>Its four inner cells become your pieces. Drop them into six formula challenges, one at a time. A rapid-fire round unlocks after MCC.</p>
        <div class="ghosts">${INNER.map((t) => `<span class="pc ${t}" style="cursor:default"><small>${NAME[t]}</small>?</span>`).join('')}</div></div>`;
    } else if (VIEW === RESULT_AT) {
      const { s, st } = totals();
      html = `<div class="stg trophy-card${anim}"><span class="tr"><svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zm-1 4v1a2 2 0 0 0 1.2 1.8C7.1 9.2 7 8.6 7 8V7zm11 0v1c0 .6-.1 1.2-.2 1.8A2 2 0 0 0 18 8V7z"/></svg></span>
        <h3>Round complete</h3><span class="tot">${s}<small style="font-size:14px;color:var(--fa)"> / ${SCORE_MAX}</small></span><span style="color:var(--mu);font-size:12.5px">${st} of ${STAR_MAX} stars, including ${starsOf(MX.pts)} for the matrix</span>
        <div class="grid6">${CHALLENGES.map((c) => `<div class="g"><b>${c.name}</b><span>${f2(c.value(counts()))}</span>${starHTML(starsOf(G[c.k].pts))}</div>`).join('')}<div class="g"><b>Rapid fire</b><span>${RF.pts}</span>${starHTML(starsOf(RF.pts))}</div></div>
        <button type="button" class="mini li" data-act="again" style="margin-top:4px">Play a new scenario</button></div>`;
    } else if (VIEW === RAPID_AT) {
      html = rapidHtml(anim);
    } else {
      const c = CHALLENGES[VIEW];
      const g = G[c.k];
      const ready = filled(c.k);
      const board = formulaHtml(c);
      if (ready && !g.opts) g.opts = makeOpts(c.k, counts());
      const right = f2(c.value(counts()));
      html = `<div class="stg ${g.solved ? 'won' : ''}${anim}" data-k="${c.k}">
        <div class="sh"><span class="big">${g.solved ? '✓' : VIEW + 1}</span>
          <div class="tt"><em>Challenge ${VIEW + 1} of ${CHALLENGES.length}</em><b>${esc(c.name)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}<span>${esc(c.what)}</span></div>
          <div class="pot">${starHTML(starsOf(g.pts))}<b>${g.pts}</b><span>${g.solved ? 'points won' : 'points to win'}</span></div></div>
        ${piecesHTML(c)}
        <div class="board" data-k="${c.k}"><span class="f">${board}</span></div>
        ${g.peek ? `<div class="peek"><span>Formula</span><span class="f lt">${lettersHtml(c.k)}</span></div>` : ''}
        ${
          g.solved
            ? `<div class="win"><span class="ck">✓</span><div><div class="wv">${right}</div><div class="wl">${esc(c.name)}</div></div><span class="grow"></span><span class="bigstars">${[0, 1, 2].map((j) => STAR.replace('<svg', `<svg class="${j < starsOf(g.pts) ? 'on' : ''}"`)).join('')}</span><span class="wp">+${g.pts}</span></div>`
            : ready
              ? `<div class="ask"><b>What does it come to?</b><span>Work it out, then pick. Wrong picks cost ${PTS.pick}.</span></div>
          <div class="opts">${(g.opts || []).map((o) => `<button type="button" class="opt ${g.picks.includes(o) ? 'no' : ''}" data-act="opt" data-k="${c.k}" data-o="${o}" ${g.picks.includes(o) ? 'disabled' : ''}>${o}</button>`).join('')}</div>`
              : `<div class="ask"><span>Which ${c.needs ? 'pieces' : 'cells'} go where? Wrong drops cost ${PTS.drop}.</span>${g.peek ? '' : `<button type="button" class="lnk" data-act="peek" data-k="${c.k}">Peek at the formula (−${PTS.peek})</button>`}</div>`
        }
      </div>`;
    }
    const stage = $('#stage');
    if (stage) stage.innerHTML = html;
    const pv = $<HTMLButtonElement>('#prevBtn');
    const nx = $<HTMLButtonElement>('#nextBtn');
    if (pv) pv.disabled = locked || VIEW === 0;
    if (nx) {
      nx.disabled = locked || VIEW >= R;
      nx.classList.toggle('go2', !locked && VIEW < R);
    }
    const msg = $('#navMsg');
    if (msg) {
      if (locked) msg.textContent = 'Six challenges, then a rapid-fire round';
      else if (VIEW === RESULT_AT) msg.innerHTML = '<b>Every challenge done</b>';
      else if (VIEW === RAPID_AT) msg.innerHTML = RF.solved ? '<b>See your result</b>' : `Question ${RF.cursor + 1} of ${RAPID_QUESTIONS.length}`;
      else if (!G[CHALLENGES[VIEW].k].solved) msg.textContent = 'Solve this one to unlock the next';
      else if (VIEW + 1 < CHALLENGES.length) msg.innerHTML = `Next up: <b>${esc(CHALLENGES[VIEW + 1].name)}</b>`;
      else msg.innerHTML = '<b>Next up: Rapid fire</b>';
    }
    markSel();
  }

  function go(i: number) {
    const R = reached();
    if ($('#cMetrics')?.classList.contains('locked')) return;
    if (i < 0 || i > R || i === VIEW) return;
    DIR = i > VIEW ? 'next' : 'prev';
    VIEW = i;
    SEL = null;
    renderChallenges();
  }

  function maybeComplete() {
    if (finished || !RF.solved || !CHALLENGES.every((c) => G[c.k].solved)) return;
    finished = true;
    onComplete?.();
  }

  function levelButton(opts: {
    go: number;
    label: string;
    aria: string;
    done: boolean;
    cur: boolean;
    view: boolean;
    disabled: boolean;
    dot: string;
    stars: number;
    trophy?: boolean;
  }): string {
    const linkOn = opts.done || opts.cur;
    const stars =
      opts.stars > 0
        ? [0, 1, 2].map((j) => STAR.replace('<svg', `<svg class="${j < opts.stars ? 'on' : ''}"`)).join('')
        : '';
    return `<span class="link ${linkOn ? 'on' : ''}"><i></i></span><button type="button" class="lv ${opts.trophy ? 'trophy' : ''} ${opts.done ? 'done' : ''} ${opts.cur ? 'cur' : ''} ${opts.view ? 'view' : ''}" data-go="${opts.go}" ${opts.disabled ? 'disabled' : ''} aria-label="${esc(opts.aria)}"><span class="dot">${opts.dot}</span><small>${esc(opts.label)}</small><span class="ms">${stars}</span></button>`;
  }

  function rapidPot(): string {
    return `<div class="pot">${starHTML(starsOf(RF.pts))}<b>${RF.pts}</b><span>${RF.solved ? 'points won' : 'points to win'}</span></div>`;
  }

  function syncRapidPot() {
    const pot = host.querySelector('[data-rapid] .pot');
    if (!pot) return;
    const b = pot.querySelector('b');
    if (b) b.textContent = String(RF.pts);
    const n = starsOf(RF.pts);
    pot.querySelectorAll('.stars svg').forEach((svg, i) => svg.classList.toggle('on', i < n));
  }

  function rapidHtml(anim: string): string {
    const pos = SC?.dom.pos ?? 'positive';
    if (RF.solved) {
      const rows = RAPID_QUESTIONS.map(
        (q) =>
          `<li><span class="ck">✓</span><div><b>${esc(rapidLabel(q.answer))}</b><span>${esc(q.why)}</span></div></li>`,
      ).join('');
      return `<div class="stg won${anim}" data-rapid="1">
        <div class="sh"><span class="big">✓</span>
          <div class="tt"><em>Special round</em><b>Rapid fire</b><span>Four questions, one metric each.</span></div>
          ${rapidPot()}</div>
        <ul class="rapid-list">${rows}</ul>
        <div class="win"><span class="ck">✓</span><div><div class="wv">${RF.pts}</div><div class="wl">Rapid fire</div></div><span class="grow"></span><span class="bigstars">${[0, 1, 2].map((j) => STAR.replace('<svg', `<svg class="${j < starsOf(RF.pts) ? 'on' : ''}"`)).join('')}</span><span class="wp">+${RF.pts}</span></div>
      </div>`;
    }
    const q = RAPID_QUESTIONS[RF.cursor];
    if (!q) return '';
    const pips = RAPID_QUESTIONS.map(
      (_, i) => `<i class="${i < RF.cursor ? 'on' : ''} ${i === RF.cursor ? 'cur' : ''}"></i>`,
    ).join('');
    const opts = RAPID_CHOICES.map((c) => {
      const missed = RF.misses.includes(c.k);
      return `<button type="button" class="opt ${missed ? 'no' : ''}" data-act="rapid" data-o="${c.k}" ${missed ? 'disabled' : ''}>${esc(c.label)}</button>`;
    }).join('');
    return `<div class="stg${anim}" data-rapid="1">
      <div class="sh"><span class="big">${BOLT.replace('width="15" height="15"', 'width="22" height="22"')}</span>
        <div class="tt"><em>Special round · after MCC</em><b>Rapid fire</b><span>Question ${RF.cursor + 1} of ${RAPID_QUESTIONS.length}. Which metric fits?</span></div>
        ${rapidPot()}</div>
      <div class="pips" aria-hidden="true">${pips}</div>
      <p class="rapid-q">${esc(q.ask(pos))}</p>
      <div class="ask"><span>Wrong picks cost ${PTS.pick}.</span></div>
      <div class="opts words">${opts}</div>
    </div>`;
  }

  function chooseRapid(o: RapidMetric, btn: HTMLElement) {
    if (rapidBusy || RF.solved || RF.misses.includes(o)) return;
    const q = RAPID_QUESTIONS[RF.cursor];
    if (!q) return;
    if (o === q.answer) {
      rapidBusy = true;
      const last = RF.cursor === RAPID_QUESTIONS.length - 1;
      RF.cursor += 1;
      RF.misses = [];
      if (last) RF.solved = true;
      hit();
      btn.classList.add('yes');
      if (last) {
        const r = btn.getBoundingClientRect();
        fly(r.left + r.width / 2, r.top, `+${RF.pts}`);
        renderHud(['#hScore', '#hStars']);
      }
      later(() => {
        rapidBusy = false;
        renderChallenges();
        if (last) maybeComplete();
      }, 450);
      return;
    }
    RF.misses.push(o);
    RF.pts = Math.max(PTS.min, RF.pts - PTS.pick);
    miss();
    syncRapidPot();
    btn.classList.add('no', 'shake');
    if (btn instanceof HTMLButtonElement) btn.disabled = true;
    flyAt(btn, `−${PTS.pick}`, true);
  }

  function drop(k: ChallengeKey, b: string, i: number, t: string, label: string, slotEl: HTMLElement | null) {
    const g = G[k];
    if (g.solved || g.slots[b]?.[i]) return;
    const c = challengeByKey(k);
    const trial = JSON.parse(JSON.stringify(g.slots)) as ChallengeState['slots'];
    trial[b][i] = { t: t as Piece, l: label };
    if (!placementOk(c.fam, trial)) {
      lose(k, PTS.drop);
      miss();
      if (slotEl) {
        slotEl.classList.remove('nope');
        void slotEl.offsetWidth;
        slotEl.classList.add('nope');
        flyAt(slotEl, `−${PTS.drop}`, true);
        later(() => slotEl.classList.remove('nope'), 450);
      }
      return;
    }
    g.slots[b][i] = { t: t as Piece, l: label };
    hit();
    renderChallenges();
  }

  function choose(k: ChallengeKey, o: string, btn: HTMLElement) {
    const g = G[k];
    if (g.solved || g.picks.includes(o)) return;
    if (o === f2(challengeByKey(k).value(counts()))) {
      g.solved = true;
      hit();
      btn.classList.add('yes');
      const r = btn.getBoundingClientRect();
      fly(r.left + r.width / 2, r.top, `+${g.pts}`);
      renderHud(['#hScore', '#hStars']);
      later(() => {
        renderChallenges();
        renderMatrix();
        maybeComplete();
      }, 450);
    } else {
      g.picks.push(o);
      lose(k, PTS.pick);
      miss();
      btn.classList.add('no', 'shake');
      if (btn instanceof HTMLButtonElement) btn.disabled = true;
      flyAt(btn, `−${PTS.pick}`, true);
    }
  }

  function under(x: number, y: number, sel: string): HTMLElement | null {
    const el = document.elementFromPoint(x, y);
    const hit = el?.closest(sel);
    return hit && host.contains(hit) ? (hit as HTMLElement) : null;
  }

  function clearDragChrome() {
    $$('.over').forEach((x) => x.classList.remove('over'));
    $('#mx')?.classList.remove('target');
    $$('.board').forEach((b) => b.classList.remove('target'));
    host.style.cursor = '';
  }

  function onPointerMove(e: PointerEvent) {
    if (!DRAG || e.pointerId !== DRAG.id) return;
    if (!DRAG.moved && Math.hypot(e.clientX - DRAG.x, e.clientY - DRAG.y) < 5) return;
    if (!DRAG.moved) {
      DRAG.moved = true;
      SEL = null;
      markSel();
      const g = document.createElement('div');
      if (DRAG.kind === 'piece') {
        g.className = `ghost ${DRAG.t || ''}`;
        g.innerHTML = `${esc(DRAG.label)}<small>${NAME[DRAG.t || ''] || DRAG.t}</small>`;
        $$('.board').forEach((b) => b.classList.add('target'));
      } else {
        g.className = 'ghost';
        g.textContent = fmtN(DRAG.val || 0);
        $('#mx')?.classList.add('target');
      }
      host.appendChild(g);
      DRAG.ghost = g;
      host.style.cursor = 'grabbing';
    }
    e.preventDefault();
    if (DRAG.ghost) {
      DRAG.ghost.style.left = `${e.clientX}px`;
      DRAG.ghost.style.top = `${e.clientY}px`;
    }
    const sel = DRAG.kind === 'piece' ? '.slot:not(.on)' : '.cell:not(.lock)';
    const t = under(e.clientX, e.clientY, sel);
    $$('.over').forEach((x) => {
      if (x !== t) x.classList.remove('over');
    });
    t?.classList.add('over');
    const main = host.querySelector('main');
    if (main) {
      const r = main.getBoundingClientRect();
      if (e.clientY < r.top + 36) main.scrollBy(0, -14);
      else if (e.clientY > r.bottom - 36) main.scrollBy(0, 14);
    }
  }

  function endDrag(e?: PointerEvent) {
    if (!DRAG || (e && e.pointerId !== DRAG.id)) return;
    const d = DRAG;
    DRAG = null;
    detachDrag();
    $$('.over').forEach((x) => x.classList.remove('over'));
    if (!d.moved) {
      if (d.kind === 'piece' && d.el) pickPiece(d.el);
      else if (d.el) pickChip(d.el);
      host.style.cursor = '';
      return;
    }
    d.ghost?.remove();
    $('#mx')?.classList.remove('target');
    $$('.board').forEach((b) => b.classList.remove('target'));
    host.style.cursor = '';
    const up = Boolean(e && e.type === 'pointerup');
    if (d.kind === 'piece') {
      const s = up && e ? under(e.clientX, e.clientY, '.slot:not(.on)') : null;
      if (s && d.t) drop(s.dataset.k as ChallengeKey, s.dataset.b || '', Number(s.dataset.i), d.t, d.label || '', s);
      return;
    }
    const c = up && e ? under(e.clientX, e.clientY, '.cell') : null;
    if (c && !c.classList.contains('lock')) {
      if (d.fromCell && d.fromCell !== c.dataset.c) CELL[d.fromCell] = { val: '', src: null, mark: null };
      setCell(c.dataset.c || '', d.val ?? '', d.src);
    } else if (d.fromCell && up) setCell(d.fromCell, '');
    markSel();
  }

  function onPointerUp(e: PointerEvent) {
    endDrag(e);
  }
  function onPointerCancel() {
    if (DRAG?.ghost) DRAG.ghost.remove();
    DRAG = null;
    clearDragChrome();
    detachDrag();
  }
  function attachDrag() {
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }
  function detachDrag() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button > 0) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || !host.contains(target)) return;
    const chip = target.closest('.num');
    const piece = target.closest('.ghosts') ? null : target.closest('.cell.src,.pc');
    const cell = !chip && !piece ? target.closest('.cell.filled:not(.lock)') : null;
    if (piece instanceof HTMLElement) {
      const t = piece.dataset.c || piece.dataset.t || '';
      const v = piece.dataset.c ? fmtN(counts()[t as keyof Counts] as number) : piece.dataset.v || '';
      DRAG = { kind: 'piece', t, label: v, el: piece, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      attachDrag();
      e.preventDefault();
      return;
    }
    if (cell instanceof HTMLElement && (target.closest('.clr') || document.activeElement === cell.querySelector('input'))) return;
    if (!(chip instanceof HTMLElement) && !(cell instanceof HTMLElement)) return;
    if (cell instanceof HTMLElement && !CELL[cell.dataset.c || '']?.src) return;
    DRAG = {
      kind: 'story',
      val: chip instanceof HTMLElement ? Number(chip.dataset.v) : Number(CELL[cell instanceof HTMLElement ? cell.dataset.c || '' : ''].val),
      src: chip instanceof HTMLElement ? chip.dataset.id : CELL[cell instanceof HTMLElement ? cell.dataset.c || '' : ''].src || undefined,
      fromCell: cell instanceof HTMLElement ? cell.dataset.c : null,
      el: chip instanceof HTMLElement ? chip : null,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      id: e.pointerId,
    };
    attachDrag();
    if (chip) e.preventDefault();
  }

  function pickChip(chip: HTMLElement) {
    SEL = SEL?.kind === 'story' && SEL.id === chip.dataset.id ? null : { kind: 'story', id: chip.dataset.id || '' };
    markSel();
  }
  function pickPiece(el: HTMLElement) {
    const t = el.dataset.c || el.dataset.t || '';
    SEL =
      SEL?.kind === 'piece' && SEL.t === t
        ? null
        : { kind: 'piece', t, label: el.dataset.c ? fmtN(counts()[t as keyof Counts] as number) : el.dataset.v || '' };
    markSel();
  }
  function placeSelected(k: string) {
    if (SEL?.kind !== 'story') return;
    const chip = host.querySelector(`.num[data-id="${SEL.id}"]`);
    if (!(chip instanceof HTMLElement)) return;
    setCell(k, Number(chip.dataset.v), SEL.id);
    SEL = null;
    markSel();
    host.querySelector<HTMLInputElement>(`.cell[data-c="${k}"] input`)?.blur();
  }

  function onClick(e: MouseEvent) {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || !host.contains(t)) return;
    if (t.closest('#fsBtn') || t.closest('[data-theme-set]')) return;
    if (t.closest('#newBtn')) {
      newScenario();
      return;
    }
    if (t.closest('#clrBtn')) {
      ORDER.forEach((k) => {
        CELL[k] = { val: '', src: null, mark: null };
      });
      setStatus('', '');
      renderMatrix();
      return;
    }
    if (t.closest('#checkMx')) {
      checkMatrix();
      return;
    }
    if (t.closest('#prevBtn')) {
      go(VIEW - 1);
      return;
    }
    if (t.closest('#nextBtn')) {
      go(VIEW + 1);
      return;
    }
    const lv = t.closest('.lv[data-go]');
    if (lv instanceof HTMLElement && !lv.hasAttribute('disabled')) {
      go(Number(lv.dataset.go));
      return;
    }
    if (t.closest('#revealMx')) {
      revealMatrix();
      return;
    }
    const clr = t.closest('.clr');
    if (clr) {
      const cell = clr.closest('.cell');
      if (cell instanceof HTMLElement && !MX.done) setCell(cell.dataset.c || '', '');
      return;
    }
    const slot = t.closest('.slot:not(.on)');
    if (slot instanceof HTMLElement) {
      if (SEL?.kind === 'piece') {
        const s = SEL;
        SEL = null;
        drop(slot.dataset.k as ChallengeKey, slot.dataset.b || '', Number(slot.dataset.i), s.t, s.label, slot);
        markSel();
      }
      return;
    }
    const cell = t.closest('.cell');
    if (cell instanceof HTMLElement && SEL?.kind === 'story' && !cell.classList.contains('lock')) {
      e.preventDefault();
      placeSelected(cell.dataset.c || '');
      cell.querySelector('input')?.blur();
      return;
    }
    if (e.detail === 0) {
      const nb = t.closest('.num');
      if (nb instanceof HTMLElement) {
        pickChip(nb);
        return;
      }
      const pc = t.closest('.cell.src,.pc');
      if (pc instanceof HTMLElement) {
        pickPiece(pc);
        return;
      }
    }
    const a = t.closest('[data-act]');
    if (a instanceof HTMLElement) {
      const k = a.dataset.k as ChallengeKey;
      if (a.dataset.act === 'rapid') {
        const picked = a.dataset.o || '';
        if (isRapidMetric(picked)) chooseRapid(picked, a);
      } else if (a.dataset.act === 'peek') {
        const g = G[k];
        if (g && !g.peek) {
          g.peek = true;
          lose(k, PTS.peek);
          flyAt(a, `−${PTS.peek}`, true);
          renderChallenges();
        }
      } else if (a.dataset.act === 'opt') choose(k, a.dataset.o || '', a);
      else if (a.dataset.act === 'again') newScenario();
      return;
    }
    if (SEL && !t.closest('.num,.cell.src,.pc')) {
      SEL = null;
      markSel();
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && SEL) {
      SEL = null;
      markSel();
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !target?.closest('input') && !$('#cMetrics')?.classList.contains('locked')) {
      go(VIEW + (e.key === 'ArrowRight' ? 1 : -1));
      return;
    }
    if (!(e.key === 'Enter' || e.key === ' ')) return;
    const chip = target?.closest('.num');
    if (chip instanceof HTMLElement) {
      e.preventDefault();
      pickChip(chip);
      if (SEL) host.querySelector<HTMLInputElement>('.cell:not(.lock) input')?.focus();
      return;
    }
    const pc = target?.closest('.cell.src,.pc');
    if (pc instanceof HTMLElement) {
      e.preventDefault();
      pickPiece(pc);
      if (SEL) host.querySelector<HTMLElement>('.board .slot:not(.on)')?.focus();
      return;
    }
    const cin = target?.closest('.cell input');
    if (cin instanceof HTMLInputElement && e.key === 'Enter') {
      e.preventDefault();
      if (SEL?.kind === 'story') placeSelected(cin.closest('.cell')?.getAttribute('data-c') || '');
      else checkMatrix();
    }
  }

  function onInput(e: Event) {
    const cin = e.target instanceof HTMLInputElement ? e.target : null;
    if (!cin || !cin.closest('.cell')) return;
    const cell = cin.closest('.cell');
    const k = cell?.getAttribute('data-c') || '';
    const raw = cin.value.replace(/[^\d,]/g, '');
    if (raw !== cin.value) cin.value = raw;
    CELL[k] = { val: raw.replace(/,/g, ''), src: null, mark: null };
    setStatus('', '');
    cell?.classList.toggle('filled', raw !== '');
    cell?.classList.remove('story', 'ok', 'bad', 'shown');
    const mk = cell?.querySelector('.mk');
    if (mk) mk.textContent = '';
    const clrBtn = $<HTMLButtonElement>('#clrBtn');
    if (clrBtn) clrBtn.disabled = !ORDER.some((x) => CELL[x]?.val !== '');
    markSel();
  }

  function onFocusOut(e: FocusEvent) {
    const cin = e.target instanceof HTMLInputElement ? e.target : null;
    if (!cin || !cin.closest('.cell') || MX.done) return;
    const k = cin.closest('.cell')?.getAttribute('data-c') || '';
    if (CELL[k]?.val) cin.value = fmtN(+CELL[k].val);
  }

  buildMatrix();
  newScenario();
  host.addEventListener('pointerdown', onPointerDown);
  host.addEventListener('click', onClick);
  host.addEventListener('keydown', onKeyDown);
  host.addEventListener('input', onInput);
  host.addEventListener('focusout', onFocusOut);
  host.classList.remove('is-booting');

  return () => {
    alive = false;
    timers.forEach((id) => window.clearTimeout(id));
    detachDrag();
    if (DRAG?.ghost) DRAG.ghost.remove();
    host.removeEventListener('pointerdown', onPointerDown);
    host.removeEventListener('click', onClick);
    host.removeEventListener('keydown', onKeyDown);
    host.removeEventListener('input', onInput);
    host.removeEventListener('focusout', onFocusOut);
    unbindTheme();
    unbindFs();
  };
}
