'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../i18n.js');
const G = require('../game.js');

const en = I.LANGS.en, fr = I.LANGS.fr;
const vars = (s) => (s.match(/\{(\w+)\}/g) || []).sort().join(',');

test('English and French define exactly the same keys', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  assert.ok(Object.keys(en).length > 150);
});

test('no empty strings and the same placeholders in both languages', () => {
  for (const k of Object.keys(en)) {
    assert.ok(en[k].length > 0, `empty en ${k}`);
    assert.ok(fr[k].length > 0, `empty fr ${k}`);
    assert.equal(vars(en[k]), vars(fr[k]), `placeholders differ for ${k}`);
  }
});

test('French strings are real UTF-8 French (accents present, no mojibake)', () => {
  const all = Object.values(fr).join(' ');
  assert.match(all, /é/);
  assert.match(all, /à/);
  assert.ok(!/Ã|â€/.test(all));
  assert.ok(!/Ã|â€/.test(Object.values(en).join(' ')));
});

test('make(): fills variables, falls back to English, returns the key when unknown, ignores prototype keys', () => {
  const t = I.make('fr'), te = I.make('en');
  assert.equal(te('hud.gen', { g: 3, max: 12 }), 'Generation 3 of 12');
  assert.equal(t('hud.gen', { g: 3, max: 12 }), 'Génération 3 sur 12');
  assert.equal(I.make('zz')('btn.run'), 'Run contest');
  assert.equal(I.make('__proto__')('btn.run'), 'Run contest');
  assert.equal(te('no.such.key'), 'no.such.key');
  assert.equal(te('toString'), 'toString');
  assert.equal(te('hud.gen', { g: 1 }), 'Generation 1 of {max}');
});

test('every scheme and every lesson has a title, body and short name in both languages', () => {
  for (const L of [en, fr]) {
    for (const s of G.SCHEMES) { assert.ok(L['scheme.' + s]); assert.ok(L['scheme.' + s + '.short']); assert.ok(L['scheme.' + s + '.desc'] === undefined || true); }
    for (const id of G.LESSON_IDS) { assert.ok(L['lesson.' + id + '.title'], id); assert.ok(L['lesson.' + id + '.body'], id); }
  }
});

test('lesson bodies fill completely from the measured numbers (no leftover placeholders)', () => {
  const v = G.lessonVars();
  for (const L of [en, fr]) for (const id of G.LESSON_IDS) {
    const s = G.fmt(L['lesson.' + id + '.body'], v);
    assert.ok(!/\{\w+\}/.test(s), `${id}: ${s}`);
  }
  const shield = G.fmt(en['lesson.shield.body'], v);
  assert.match(shield, /2\.3 to 3\.2/);
  assert.match(G.fmt(en['lesson.individual.body'], v), /10 of 15/);
  assert.match(G.fmt(en['lesson.amp.body'], v), /0\.004/);
  assert.match(G.fmt(en['lesson.stab.body'], v), /20 to 35 percent/);
});

test('share card lines stay within 40 characters in the worst case, in both languages, with no emoji', () => {
  const worst = { score: 100, T: 1000, F: 1000, precision: 1, steadiness: 1 };
  for (const [name, L] of [['en', en], ['fr', fr]]) {
    for (const seed of [null, 'abcdefghijklmnopqrstuvwx']) {
      for (const scheme of G.SCHEMES) {
        const card = G.buildShare({ labels: L, seed, day: 999, date: '2126-12-31', result: worst, settings: Object.assign({}, G.DEFAULTS, { scheme, w: 1, shield: true, amp: true, stab: true }), ref: 100, url: 'https://example.invalid/#x' });
        const lines = card.split('\n');
        assert.equal(lines.length, 7);
        lines.slice(0, 6).forEach((ln) => assert.ok([...ln].length <= 40, `${name}: "${ln}" is ${[...ln].length}`));
        assert.ok(!/\p{Extended_Pictographic}/u.test(card));
        assert.match(card, /SYNTH/);
      }
    }
  }
});

test('share card omits the reference when the repository has none, and the URL line when absent', () => {
  const r = { score: 71.4, T: 40, F: 3, precision: 0.93, steadiness: 0.8 };
  const card = G.buildShare({ labels: en, seed: 'abc', result: r, settings: Object.assign({}, G.DEFAULTS), ref: null });
  assert.ok(!/repo ref/.test(card));
  assert.equal(card.split('\n').length, 6);
  assert.match(card, /Score 71\/100/);
  assert.match(card, /True 40  False 3  Prec 93%/);
});

test('the synthetic label is present in every language', () => {
  for (const L of [en, fr]) {
    assert.match(L['tag.synthetic'], /SYNTH/);
    assert.match(L['footer.disclaimer'], /SYNTH/);
    assert.match(L['share.synthetic'], /SYNTH/);
  }
  assert.match(en['footer.privacy'], /no network calls/);
});
