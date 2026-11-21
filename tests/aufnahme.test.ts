// The limits as a protection (Tobias 2026-11-21): an app takes only so many groups (tenants), the Treffpunkt only so many
// devices at all. Beyond it a new group is refused — by every way of enrolling — before anything is used up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gruenderAusstellen, passwortHash, auswertungAusstellen } from '../src/zulassung.ts';
import { einladungAusstellen } from '../src/zugang.ts';
import {
  AZP,
  aufbauen,
  einschreiben,
  einschreibenMitSchluessel,
  entwicklerPaar,
  merken,
  neuesGeraet,
  nachweis,
  post,
  postNeu,
  TKD,
  zufallN,
  type Aufbau,
} from './hilfen.ts';

const art = (r: { daten: Record<string, unknown> }) => r.daten['art'];
const jetztS = (a: Aufbau) => Math.floor((a.uhr.ms + a.uhr.wand) / 1000);
const nachweisFuer = (a: Aufbau, app: string) =>
  nachweis(a.paar, { v: 1, app, bis: jetztS(a) + 300, n: zufallN() });

async function gesund(a: Aufbau, origin: string) {
  const r = await a.t.behandeln({
    methode: 'GET',
    pfad: '/gesund',
    kopf: { origin },
    koerper: Buffer.alloc(0),
  });
  return JSON.parse(r.koerper) as Record<string, unknown>;
}

test('limit 0: no way of enrolling starts a group — the login proof, the old and the new invitation, the founder ticket, the password', async () => {
  const e = entwicklerPaar();
  const a = aufbauen({
    mandanten: { tkd: 0 },
    entwickler: {
      schluessel: [e.roh],
      passwoerter: [
        {
          app: 'tkd',
          mandant: 'vorfuehrung',
          hash: passwortHash('invented'),
          bis: jetztS(aufbauen()) + 86_400,
          hoechstens: 3,
        },
      ],
    },
  });
  const key = neuesGeraet().paar.roh;
  // login proof (old way, no key and with key)
  assert.equal(
    art(await post(a, 'einschreiben', { nachweis: nachweisFuer(a, 'tkd') }, { herkunft: TKD })),
    'aufnahme-geschlossen',
  );
  assert.equal(art(await einschreibenMitSchluessel(a, neuesGeraet())), 'aufnahme-geschlossen');
  // an invitation made with the secret (old way)
  const alt = einladungAusstellen(a.schluessel, 'tkd', jetztS(a));
  assert.equal(
    art(await post(a, 'einschreiben', { einladung: alt.einladung }, { herkunft: TKD })),
    'aufnahme-geschlossen',
  );
  // founder ticket, password
  const ticket = gruenderAusstellen(e.privat, { app: 'tkd', mandant: '2', bis: jetztS(a) + 600 });
  assert.equal(
    art(
      await post(a, 'einschreiben', { gruender: ticket, geraetSchluessel: key }, { herkunft: TKD }),
    ),
    'aufnahme-geschlossen',
  );
  assert.equal(
    art(
      await post(
        a,
        'einschreiben',
        { passwort: 'invented', app: 'tkd', mandant: 'vorfuehrung', geraetSchluessel: key },
        { herkunft: TKD },
      ),
    ),
    'aufnahme-geschlossen',
  );
  // the refusal is 403, readable by the app's page, and the app can see beforehand that nothing is taken
  const r = await post(
    a,
    'einschreiben',
    { gruender: ticket, geraetSchluessel: key },
    { herkunft: TKD },
  );
  assert.equal(r.status, 403);
  assert.equal(r.kopf['Access-Control-Allow-Origin'], TKD);
  assert.equal((await gesund(a, TKD))['aufnahmeOffen'], false);
});

test('a refusal uses nothing up: the ticket, the proof and the password still work once the limit is raised', async () => {
  const e = entwicklerPaar();
  const zu = aufbauen({ mandanten: { tkd: 0 }, entwickler: { schluessel: [e.roh] } });
  const ticket = gruenderAusstellen(e.privat, { app: 'tkd', mandant: '2', bis: jetztS(zu) + 600 });
  const key = neuesGeraet().paar.roh;
  assert.equal(
    art(
      await post(
        zu,
        'einschreiben',
        { gruender: ticket, geraetSchluessel: key },
        { herkunft: TKD },
      ),
    ),
    'aufnahme-geschlossen',
  );
  assert.equal(zu.t.zaehlstand().marken, 0, 'no mark of a used ticket');
  assert.equal(zu.t.zaehlstand().geraete, 0);
  // the same Treffpunkt, the same secret and clock, with the limit raised: a new instance as a restart at bunny gives
  const auf = aufbauen({ mandanten: { tkd: 1 }, entwickler: { schluessel: [e.roh] } });
  const ticket2 = gruenderAusstellen(e.privat, {
    app: 'tkd',
    mandant: '2',
    bis: jetztS(auf) + 600,
  });
  assert.equal(
    (
      await post(
        auf,
        'einschreiben',
        { gruender: ticket2, geraetSchluessel: key },
        { herkunft: TKD },
      )
    ).status,
    201,
  );
});

test('limit 1: the first group is taken, a second one is refused, the group that exists keeps growing, another app is not touched', async () => {
  const e = entwicklerPaar();
  const a = aufbauen({ mandanten: { azp: 1, tkd: 0 }, entwickler: { schluessel: [e.roh] } });
  assert.equal((await gesund(a, AZP))['aufnahmeOffen'], true);
  const erstes = neuesGeraet();
  const r = await einschreibenMitSchluessel(a, erstes, { rolle: 'buero' }, 'azp');
  assert.equal(r.status, 201);
  assert.equal((await gesund(a, AZP))['aufnahmeOffen'], false);
  // a second group (a founder ticket for tenant 2) is refused …
  const zweiter = gruenderAusstellen(e.privat, { app: 'azp', mandant: '2', bis: jetztS(a) + 600 });
  assert.equal(
    art(
      await post(
        a,
        'einschreiben',
        { gruender: zweiter, geraetSchluessel: neuesGeraet().paar.roh },
        { herkunft: AZP },
      ),
    ),
    'aufnahme-geschlossen',
  );
  // … the group that exists takes more devices (invited by its office device, and by the login proof) …
  const einl = await postNeu(a, erstes, 'einladen', { rolle: 'ohne' }, { herkunft: AZP });
  const gast = neuesGeraet();
  const g = await post(
    a,
    'einschreiben',
    { einladung: einl.daten['einladung'], geraetSchluessel: gast.paar.roh },
    { herkunft: AZP },
  );
  assert.equal(g.status, 201);
  merken(gast, g);
  assert.equal((await einschreibenMitSchluessel(a, neuesGeraet(), {}, 'azp')).status, 201);
  // … and the other app, with its own limit 0, takes nothing
  assert.equal(
    art(await post(a, 'einschreiben', { nachweis: nachweisFuer(a, 'tkd') }, { herkunft: TKD })),
    'aufnahme-geschlossen',
  );
});

test('old devices of a group that exists go on, whatever the limit says (it is a gate for new groups only)', async () => {
  const a = aufbauen({ mandanten: { tkd: 1 } });
  const alt = await einschreiben(a);
  assert.equal((await post(a, 'ping', {}, { zugang: alt.zugang })).status, 200);
  const g = await einschreiben(a);
  assert.equal((await post(a, 'ping', {}, { zugang: g.zugang })).status, 200);
});

test('devices altogether: at the limit no new device is taken, anywhere, and the answer says the Treffpunkt is full', async () => {
  const a = aufbauen({ grenzen: { geraeteGesamt: 2 } });
  await einschreiben(a, 'tkd');
  await einschreiben(a, 'azp');
  const r = await post(a, 'einschreiben', { nachweis: nachweisFuer(a, 'tkd') }, { herkunft: TKD });
  assert.equal(art(r), 'treffpunkt-voll');
  assert.equal(r.status, 503);
  assert.equal((await gesund(a, TKD))['aufnahmeOffen'], false);
  assert.equal((await gesund(a, AZP))['aufnahmeOffen'], false);
  // a refused try uses no proof up
  assert.equal(a.t.zaehlstand().marken, 2);
});

test('the evaluation shows how far each app has used its limit and the devices altogether; numbers only', async () => {
  const e = entwicklerPaar();
  const a = aufbauen({ mandanten: { azp: 2, tkd: 0 }, entwickler: { schluessel: [e.roh] } });
  await einschreibenMitSchluessel(a, neuesGeraet(), {}, 'azp');
  const ticket = auswertungAusstellen(e.privat, jetztS(a) + 300);
  const r = await post(a, 'auswertung', { ticket }, { herkunft: null });
  assert.equal(r.status, 200);
  assert.deepEqual(r.daten['aufnahme'], {
    apps: [
      { app: 'tkd', mandantenMax: 0, mandanten: 0 },
      { app: 'azp', mandantenMax: 2, mandanten: 1 },
    ],
    geraeteGesamt: 1,
    geraeteGesamtMax: 300,
  });
});
