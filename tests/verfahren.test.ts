// What the Treffpunkt tells about the techniques it serves and prefers (`verfahren`): in `/gesund` (readable by the
// page of a known app, before it enrols), in `ping` for an app that announces its protocol version, and in the
// answers of enrolling and renewing with a key. An old app gets nothing new.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAEHIGKEITEN, VERSION, verfahrenFuer } from '../src/treffpunkt.ts';
import {
  AZP,
  aufbauen,
  einschreiben,
  einschreibenMitSchluessel,
  FREMD,
  neuesGeraet,
  post,
  postNeu,
  TKD,
  type Aufbau,
} from './hilfen.ts';

const ALLE = ['nachweis', 'einladung', 'einladung2', 'gruender', 'passwort'];
const NEU = ['einladung2', 'gruender', 'passwort'];

async function gesund(a: Aufbau, origin?: string) {
  const r = await a.t.behandeln({
    methode: 'GET',
    pfad: '/gesund',
    kopf: origin === undefined ? {} : { origin },
    koerper: Buffer.alloc(0),
  });
  return {
    status: r.status,
    kopf: r.kopf,
    daten: JSON.parse(r.koerper) as Record<string, unknown>,
  };
}

test('verfahrenFuer: the old technique only in tenant 1 and only where `streng` has not switched it off', () => {
  const offen = { streng: new Set<string>() };
  const streng = { streng: new Set(['1']) };
  assert.deepEqual(verfahrenFuer(offen, '1'), {
    angeboten: ['zugang', 'zertifikat'],
    bevorzugt: 'zertifikat',
    einschreiben: ALLE,
  });
  assert.deepEqual(verfahrenFuer(streng, '1'), {
    angeboten: ['zertifikat'],
    bevorzugt: 'zertifikat',
    einschreiben: NEU,
  });
  // another tenant never had the old ticket (it means tenant 1), strict or not
  assert.deepEqual(verfahrenFuer(offen, 'schule-2').angeboten, ['zertifikat']);
  assert.deepEqual(verfahrenFuer(offen, 'schule-2').einschreiben, NEU);
  // without an app: what the code serves at all
  assert.deepEqual(verfahrenFuer(undefined, '1').angeboten, ['zugang', 'zertifikat']);
  // it always prefers the certificate
  for (const m of ['1', 'x']) assert.equal(verfahrenFuer(offen, m).bevorzugt, 'zertifikat');
});

test('/gesund: without a known origin what the code serves; no CORS header', async () => {
  const a = aufbauen();
  const r = await gesund(a);
  assert.equal(r.status, 200);
  assert.deepEqual(r.daten['verfahren'], verfahrenFuer(undefined, '1'));
  assert.equal(r.daten['v'], VERSION);
  assert.deepEqual(r.daten['faehigkeiten'], [...FAEHIGKEITEN]);
  assert.equal(r.daten['app'], undefined);
  assert.equal(r.kopf['Access-Control-Allow-Origin'], undefined);
  const fremd = await gesund(a, FREMD);
  assert.equal(fremd.kopf['Access-Control-Allow-Origin'], undefined);
  assert.equal(fremd.daten['app'], undefined);
});

test('/gesund: the page of a known app may read it and learns what its own app is served', async () => {
  const a = aufbauen({ streng: { azp: ['1'] } });
  const tkd = await gesund(a, TKD);
  assert.equal(tkd.kopf['Access-Control-Allow-Origin'], TKD);
  assert.equal(tkd.kopf['Vary'], 'Origin');
  assert.equal(tkd.daten['app'], 'tkd');
  assert.equal(tkd.daten['altAbgeschaltet'], false);
  assert.deepEqual(tkd.daten['verfahren'], verfahrenFuer({ streng: new Set() }, '1'));
  // the app whose tenant 1 is strict hears it: no old ticket, the new ways of enrolling only
  const azp = await gesund(a, AZP);
  assert.equal(azp.kopf['Access-Control-Allow-Origin'], AZP);
  assert.equal(azp.daten['app'], 'azp');
  assert.equal(azp.daten['altAbgeschaltet'], true);
  assert.deepEqual(azp.daten['verfahren'], {
    angeboten: ['zertifikat'],
    bevorzugt: 'zertifikat',
    einschreiben: NEU,
  });
  // still nothing but the method GET
  const p = await a.t.behandeln({
    methode: 'POST',
    pfad: '/gesund',
    kopf: { origin: AZP },
    koerper: Buffer.alloc(0),
  });
  assert.equal(p.status, 405);
});

test('ping: an old app (no announcement) gets the answer it always got; one that announces its version learns the Fassung', async () => {
  const a = aufbauen();
  const alt = await einschreiben(a);
  const wie = await post(a, 'ping', {}, { zugang: alt.zugang });
  assert.deepEqual(Object.keys(wie.daten).sort(), ['app', 'bis', 'geraet']);
  const mit = await post(a, 'ping', {}, { zugang: alt.zugang, kopf: { 'x-treffpunkt-p': '1' } });
  assert.equal(mit.daten['v'], VERSION);
  assert.deepEqual(mit.daten['faehigkeiten'], [...FAEHIGKEITEN]);
  assert.deepEqual(mit.daten['verfahren'], verfahrenFuer({ streng: new Set() }, '1'));
  assert.equal(mit.daten['geraet'], alt.geraet);
  // a header that is no version counts for nothing
  const murks = await post(
    a,
    'ping',
    {},
    { zugang: alt.zugang, kopf: { 'x-treffpunkt-p': 'zwei' } },
  );
  assert.deepEqual(Object.keys(murks.daten).sort(), ['app', 'bis', 'geraet']);
});

test('ping with a certificate always names the Fassung and the techniques of its tenant', async () => {
  const a = aufbauen();
  const g = neuesGeraet();
  await einschreibenMitSchluessel(a, g, { rolle: 'buero' });
  const r = await postNeu(a, g, 'ping', {});
  assert.equal(r.daten['v'], VERSION);
  assert.deepEqual(r.daten['verfahren'], verfahrenFuer({ streng: new Set() }, '1'));
  assert.equal(r.daten['mandant'], '1');
});

test('enrolling and renewing with a key answer with the techniques; the old answers stay as they were', async () => {
  const a = aufbauen();
  const g = neuesGeraet();
  const e = await einschreibenMitSchluessel(a, g, { rolle: 'buero' });
  assert.deepEqual(e.daten['verfahren'], verfahrenFuer({ streng: new Set() }, '1'));
  const erneuert = await postNeu(a, g, 'erneuern', {});
  assert.deepEqual(erneuert.daten['verfahren'], verfahrenFuer({ streng: new Set() }, '1'));
  // an old device renewing without a key: exactly as before
  const alt = await einschreiben(a);
  const alteAntwort = await post(a, 'erneuern', {}, { zugang: alt.zugang });
  assert.deepEqual(Object.keys(alteAntwort.daten).sort(), ['bis', 'zugang']);
});
