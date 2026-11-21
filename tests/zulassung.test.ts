// Admission (auftrag-zulassung): certificate with proof of possession, tenants, invitation of a
// device, founder ticket and developer password, blocking, the evaluation, `streng` — and that the
// old procedure goes on unchanged next to it (phase 1). Invented data only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FEHLER, type Fehlerart } from '../src/treffpunkt.ts';
import {
  auswertungAusstellen,
  gruenderAusstellen,
  passwortHash,
  zertifikatAusstellen,
  zertifikatPruefen,
} from '../src/zulassung.ts';
import {
  AZP,
  aufbauen,
  einschreiben,
  einschreibenMitSchluessel,
  entwicklerPaar,
  FREMD,
  inhalt,
  merken,
  neuesGeraet,
  post,
  postNeu,
  schluesselpaar,
  TKD,
  type Aufbau,
  type Neugeraet,
} from './hilfen.ts';

const jetztS = (a: Aufbau) => Math.floor((a.uhr.ms + a.uhr.wand) / 1000);
const art = (r: { daten: Record<string, unknown> }) => r.daten['art'];

/** An office device of tenant `1`, enrolled with the login script's proof (legacy trust). */
async function buero(a: Aufbau, app = 'tkd'): Promise<Neugeraet> {
  const g = neuesGeraet();
  const r = await einschreibenMitSchluessel(a, g, { rolle: 'buero' }, app);
  assert.equal(r.status, 201);
  return g;
}

/** A device of `rolle` invited by `von` (new invitation), with its own key. */
async function eingeladen(
  a: Aufbau,
  von: Neugeraet,
  rolle: string | undefined,
  herkunft = TKD,
): Promise<Neugeraet> {
  const e = await postNeu(a, von, 'einladen', rolle === undefined ? {} : { rolle }, { herkunft });
  assert.equal(e.status, 201, JSON.stringify(e.daten));
  const g = neuesGeraet();
  const r = await post(
    a,
    'einschreiben',
    { einladung: e.daten['einladung'], geraetSchluessel: g.paar.roh },
    { herkunft },
  );
  assert.equal(r.status, 201, JSON.stringify(r.daten));
  merken(g, r);
  return g;
}

const gruenderFuer = (
  a: Aufbau,
  e: ReturnType<typeof entwicklerPaar>,
  app: string,
  mandant: string,
) => gruenderAusstellen(e.privat, { app, mandant, bis: jetztS(a) + 3600 });

test('a certificate is signed by the Treffpunkt: another secret, a change or the end refuses it', () => {
  const a = aufbauen();
  const g = neuesGeraet();
  const z = {
    app: 'tkd',
    mandant: '1',
    geraet: `geraet-${'a'.repeat(32)}`,
    rolle: 'buero',
    schluessel: g.paar.roh,
  };
  const { zertifikat, bis } = zertifikatAusstellen(a.schluessel, z, 1_800_000_000);
  assert.deepEqual(zertifikatPruefen(a.schluessel, zertifikat, 1_800_000_000), { ...z, bis });
  const fremd = Buffer.alloc(32, 9);
  assert.deepEqual(zertifikatPruefen(fremd, zertifikat, 1_800_000_000), {
    fehler: 'zugang-ungueltig',
  });
  const andereRolle = zertifikat.replace('.buero.', '.ohne.');
  assert.deepEqual(zertifikatPruefen(a.schluessel, andereRolle, 1_800_000_000), {
    fehler: 'zugang-ungueltig',
  });
  const anderesMandant = zertifikat.replace('.tkd.1.', '.tkd.2.');
  assert.deepEqual(zertifikatPruefen(a.schluessel, anderesMandant, 1_800_000_000), {
    fehler: 'zugang-ungueltig',
  });
  assert.deepEqual(zertifikatPruefen(a.schluessel, zertifikat, bis), {
    fehler: 'zugang-abgelaufen',
  });
  // No silent „standard“: the name is refused whatever signs it.
  const standard = zertifikatAusstellen(a.schluessel, { ...z, mandant: 'standard' }, 1_800_000_000);
  assert.deepEqual(zertifikatPruefen(a.schluessel, standard.zertifikat, 1_800_000_000), {
    fehler: 'zugang-ungueltig',
  });
});

test('every new refusal has its status and a German text', () => {
  const neu: Fehlerart[] = [
    'neue-fassung-noetig',
    'besitz-fehlt',
    'besitz-ungueltig',
    'besitz-zeit',
    'geraete-voll',
    'rolle-nicht-erlaubt',
    'sperrliste-voll',
    'entwickler-nicht-eingerichtet',
    'entwickler-ungueltig',
    'entwickler-abgelaufen',
    'entwickler-belegt',
  ];
  for (const k of neu) assert.ok(FEHLER[k][0] >= 400 && FEHLER[k][1].length > 5, k);
  // „Neue Fassung nötig“ must not look like blocked or expired.
  assert.notEqual(FEHLER['neue-fassung-noetig'][0], FEHLER.gesperrt[0]);
  assert.notEqual(FEHLER['neue-fassung-noetig'][0], FEHLER['zugang-abgelaufen'][0]);
});

test('phase 1: an old device (no key) enrols and works exactly as before, with no new fields', async () => {
  const a = aufbauen();
  const g = await einschreiben(a);
  assert.match(g.zugang, /^z1\.tkd\./);
  const r = await post(a, 'ping', {}, { zugang: g.zugang });
  assert.deepEqual(Object.keys(r.daten).sort(), ['app', 'bis', 'geraet']);
  const e = await post(a, 'erneuern', {}, { zugang: g.zugang });
  assert.deepEqual(Object.keys(e.daten).sort(), ['bis', 'zugang']);
  const ein = await post(a, 'einladen', {}, { zugang: g.zugang });
  assert.match(ein.daten['einladung'] as string, /^e1\./);
});

test('phase 1: enrolling with a key gives a certificate; every request then needs the proof of possession', async () => {
  const a = aufbauen();
  const g = neuesGeraet();
  const r = await einschreibenMitSchluessel(a, g, { rolle: 'buero' });
  assert.equal(r.status, 201);
  assert.match(g.zertifikat ?? '', /^c1\.tkd\.1\.geraet-/);
  assert.match(g.zugang ?? '', /^z1\./, 'tenant 1 also gets the old access for old apps');
  assert.equal(r.daten['mandant'], '1');
  assert.equal(r.daten['rolle'], 'buero');
  assert.equal(r.daten['v'], 2);
  const p = await postNeu(a, g, 'ping', {});
  assert.equal(p.status, 200);
  assert.equal(p.daten['mandant'], '1');
  assert.equal(p.daten['rolle'], 'buero');
  // The Authorization header alone, without the signature, is not enough …
  assert.equal(art(await postNeu(a, g, 'ping', {}, { signatur: 'keine' })), 'besitz-fehlt');
  // … nor a signature of another key (a stolen certificate is worthless without the device's key) …
  assert.equal(art(await postNeu(a, g, 'ping', {}, { signatur: 'fremd' })), 'besitz-ungueltig');
  // … nor one with a time too far from the clock.
  const jetzt = jetztS(a);
  assert.equal(
    art(await postNeu(a, g, 'ping', {}, { signatur: { t: jetzt - 121 } })),
    'besitz-zeit',
  );
  assert.equal(
    art(await postNeu(a, g, 'ping', {}, { signatur: { t: jetzt + 121 } })),
    'besitz-zeit',
  );
  assert.equal((await postNeu(a, g, 'ping', {}, { signatur: { t: jetzt - 120 } })).status, 200);
});

test('the signature covers the body: another body under a signature taken from a request is refused', async () => {
  const a = aufbauen();
  const g = await buero(a);
  const eingeladen2 = await eingeladen(a, g, 'ohne');
  // The device signs a drop to the first; the same signature is used for a drop to the second.
  const t = jetztS(a);
  const ok = await postNeu(
    a,
    g,
    'ablegen',
    { an: [{ geraet: eingeladen2.geraet, inhalt: inhalt('x') }] },
    { signatur: { t } },
  );
  assert.equal(ok.status, 200);
  const anderer = await postNeu(
    a,
    g,
    'ablegen',
    { an: [{ geraet: eingeladen2.geraet, inhalt: inhalt('y') }] },
    { signatur: 'fremd' },
  );
  assert.equal(art(anderer), 'besitz-ungueltig');
});

test('a signed request taken twice within its time is refused the second time (replay)', async () => {
  const a = aufbauen();
  const g = await buero(a);
  const koerper = Buffer.from('{}');
  const { sign } = await import('node:crypto');
  const { besitzText } = await import('../src/zulassung.ts');
  const t = jetztS(a);
  const sig = sign(
    'sha256',
    Buffer.from(besitzText('POST', '/v1/ping', t, koerper, g.zertifikat ?? '')),
    {
      key: g.paar.privat,
      dsaEncoding: 'ieee-p1363',
    },
  ).toString('base64url');
  const schicken = async () => {
    const kopfteil = {
      methode: 'POST',
      pfad: '/v1/ping',
      kopf: {
        'content-type': 'application/json',
        'content-length': '2',
        origin: TKD,
        authorization: `Bearer ${g.zertifikat}`,
        'x-treffpunkt-signatur': `${t}.${sig}`,
      },
    };
    const vor = a.t.vorpruefen(kopfteil);
    assert.ok('hoechstens' in vor);
    try {
      return JSON.parse((await a.t.behandeln({ ...kopfteil, koerper })).koerper) as Record<
        string,
        unknown
      >;
    } finally {
      vor.freigeben();
    }
  };
  assert.equal((await schicken())['geraet'], g.geraet);
  assert.equal((await schicken())['art'], 'besitz-ungueltig');
  // After its time the signature is out of the window anyway, and the memory of it is tidied up.
  a.uhr.ms += 300_000;
  a.t.aufraeumen();
  assert.equal(a.t.zaehlstand().geraete >= 1, true);
});

test('a certificate of one app from the page of another is refused like any access, without CORS', async () => {
  const a = aufbauen();
  const g = await buero(a);
  const r = await postNeu(a, g, 'ping', {}, { herkunft: AZP });
  assert.equal(art(r), 'herkunft');
  assert.equal(r.kopf['Access-Control-Allow-Origin'], undefined);
});

test('old and new devices of tenant 1 reach each other; tenants never do', async () => {
  const a = aufbauen();
  const alt = await einschreiben(a);
  const neu = await buero(a);
  // old → new
  const r1 = await post(
    a,
    'ablegen',
    { an: [{ geraet: neu.geraet, inhalt: inhalt('alt an neu') }] },
    { zugang: alt.zugang },
  );
  assert.equal((r1.daten['ergebnisse'] as { ok: boolean }[])[0]?.ok, true);
  const h1 = await postNeu(a, neu, 'abholen', {});
  assert.equal((h1.daten['nachrichten'] as unknown[]).length, 1);
  // new → old
  const r2 = await postNeu(a, neu, 'ablegen', {
    an: [{ geraet: alt.geraet, inhalt: inhalt('neu an alt') }],
  });
  assert.equal((r2.daten['ergebnisse'] as { ok: boolean }[])[0]?.ok, true);
  const h2 = await post(a, 'abholen', {}, { zugang: alt.zugang });
  assert.equal((h2.daten['nachrichten'] as unknown[]).length, 1);
  // A second tenant, started by the developer: its devices do not see tenant 1's, and vice versa.
  const e = entwicklerPaar();
  const b = aufbauen({ entwickler: { schluessel: [e.roh] } });
  const eins = await buero(b);
  const zwei = neuesGeraet();
  const rz = await einschreibenMitGruender(b, zwei, e, '2');
  assert.equal(rz.status, 201, JSON.stringify(rz.daten));
  assert.equal(zwei.mandant, '2');
  assert.equal(zwei.zugang, undefined, 'only tenant 1 has the old access');
  const quer = await postNeu(b, eins, 'ablegen', {
    an: [{ geraet: zwei.geraet, inhalt: inhalt('x') }],
  });
  assert.equal(
    (quer.daten['ergebnisse'] as { ok: boolean }[])[0]?.ok,
    true,
    'put into its own box',
  );
  const nichts = await postNeu(b, zwei, 'abholen', {});
  assert.deepEqual(nichts.daten['nachrichten'], [], 'the other tenant never gets it');
  const eigene = await postNeu(b, eins, 'abholen', {});
  assert.deepEqual(eigene.daten['nachrichten'], []);
  // Presence does not cross tenants either.
  await postNeu(b, zwei, 'abholen', {});
  const anwesend = await postNeu(b, eins, 'abholen', { anwesend: [zwei.geraet] });
  assert.deepEqual(anwesend.daten['anwesend'], []);
});

async function einschreibenMitGruender(
  a: Aufbau,
  g: Neugeraet,
  e: ReturnType<typeof entwicklerPaar>,
  mandant: string,
  app = 'tkd',
) {
  const r = await post(
    a,
    'einschreiben',
    { gruender: gruenderFuer(a, e, app, mandant), geraetSchluessel: g.paar.roh },
    { herkunft: app === 'tkd' ? TKD : AZP },
  );
  merken(g, r);
  return r;
}

test('founder ticket: a first device of a new tenant, office role, introduced by the developer', async () => {
  const e = entwicklerPaar();
  const a = aufbauen({ entwickler: { schluessel: [e.roh] } });
  const g = neuesGeraet();
  const r = await einschreibenMitGruender(a, g, e, 'schule-2');
  assert.equal(r.status, 201);
  assert.equal(g.rolle, 'buero');
  assert.equal(g.mandant, 'schule-2');
  const liste = await postNeu(a, g, 'geraete', {});
  const eintraege = liste.daten['geraete'] as { von: string; rolle: string }[];
  assert.equal(eintraege.length, 1);
  assert.equal(eintraege[0]?.von, 'entwickler');
  assert.equal(eintraege[0]?.rolle, 'buero');
  // Once: the same ticket again is refused; it was taken.
  const nochmal = await post(
    a,
    'einschreiben',
    { gruender: gruenderFuer(a, e, 'tkd', 'schule-2'), geraetSchluessel: neuesGeraet().paar.roh },
    { herkunft: TKD },
  );
  assert.equal(
    nochmal.status,
    201,
    'a fresh ticket is a fresh ticket (recovery: more than one device)',
  );
  const t = gruenderFuer(a, e, 'tkd', 'schule-3');
  const k = neuesGeraet().paar.roh;
  assert.equal((await post(a, 'einschreiben', { gruender: t, geraetSchluessel: k })).status, 201);
  assert.equal(
    art(await post(a, 'einschreiben', { gruender: t, geraetSchluessel: k })),
    'verbraucht',
  );
});

test('founder ticket: refused with another key, when expired, too long-lived, without a key or for another origin', async () => {
  const e = entwicklerPaar();
  const a = aufbauen({ entwickler: { schluessel: [e.roh] } });
  const k = neuesGeraet().paar.roh;
  const mit = (gruender: string, extra: Record<string, unknown> = { geraetSchluessel: k }) =>
    post(a, 'einschreiben', { gruender, ...extra });
  const fremd = entwicklerPaar();
  assert.equal(art(await mit(gruenderFuer(a, fremd, 'tkd', '2'))), 'entwickler-ungueltig');
  assert.equal(
    art(await mit(gruenderAusstellen(e.privat, { app: 'tkd', mandant: '2', bis: jetztS(a) - 1 }))),
    'entwickler-abgelaufen',
  );
  assert.equal(
    art(
      await mit(gruenderAusstellen(e.privat, { app: 'tkd', mandant: '2', bis: jetztS(a) + 7200 })),
    ),
    'entwickler-abgelaufen',
    'it is for one hour, not for days',
  );
  assert.equal(
    art(await mit(gruenderFuer(a, e, 'tkd', '2'), {})),
    'unlesbar',
    'a tenant has no old access',
  );
  assert.equal(
    art(await mit(gruenderFuer(a, e, 'tkd', '2'), { geraetSchluessel: k, rolle: 'buero' })),
    'unlesbar',
    'the role comes from the ticket',
  );
  assert.equal(
    art(
      await post(
        a,
        'einschreiben',
        { gruender: gruenderFuer(a, e, 'tkd', '2'), geraetSchluessel: k },
        { herkunft: AZP },
      ),
    ),
    'herkunft',
  );
  assert.equal(art(await mit(gruenderFuer(a, e, 'gibtsnicht', '2'))), 'app-unbekannt');
  const ohneSchluessel = aufbauen();
  assert.equal(
    art(
      await post(ohneSchluessel, 'einschreiben', {
        gruender: gruenderFuer(ohneSchluessel, e, 'tkd', '2'),
        geraetSchluessel: k,
      }),
    ),
    'entwickler-nicht-eingerichtet',
  );
  // Neither the app's login key nor any other key replaces the developer's.
  const ausLogin = gruenderAusstellen(a.paar.privat, {
    app: 'tkd',
    mandant: '2',
    bis: jetztS(a) + 600,
  });
  assert.equal(art(await mit(ausLogin)), 'entwickler-ungueltig');
});

test('the tenant name is checked (no „standard“, no odd characters) wherever it is named', async () => {
  const e = entwicklerPaar();
  const a = aufbauen({ entwickler: { schluessel: [e.roh] } });
  const k = neuesGeraet().paar.roh;
  for (const m of ['standard', 'Schule', 'a b', 'x'.repeat(21), '']) {
    const t = gruenderAusstellen(e.privat, { app: 'tkd', mandant: m, bis: jetztS(a) + 600 });
    assert.equal(
      art(await post(a, 'einschreiben', { gruender: t, geraetSchluessel: k })),
      'entwickler-ungueltig',
      m,
    );
  }
});

const PASSWORT = 'invented-demo-password';

function mitPasswort(
  optionen: { bis?: number; hoechstens?: number; auchMitGeraeten?: boolean } = {},
  grenzen = {},
) {
  const e = entwicklerPaar();
  const a = aufbauen({
    grenzen,
    entwickler: {
      schluessel: [e.roh],
      passwoerter: [
        {
          app: 'tkd',
          mandant: 'vorfuehrung',
          hash: passwortHash(PASSWORT),
          bis: Math.floor(Date.UTC(2026, 10, 15, 12) / 1000) + (optionen.bis ?? 86_400),
          hoechstens: optionen.hoechstens ?? 2,
          ...(optionen.auchMitGeraeten === undefined
            ? {}
            : { auchMitGeraeten: optionen.auchMitGeraeten }),
        },
      ],
    },
  });
  const schicken = (passwort: string, extra: Record<string, unknown> = {}) =>
    post(a, 'einschreiben', {
      passwort,
      app: 'tkd',
      mandant: 'vorfuehrung',
      geraetSchluessel: neuesGeraet().paar.roh,
      ...extra,
    });
  return { a, e, schicken };
}

test('developer password: a first device of the named tenant while it has none, at most N times, until its end', async () => {
  const { a, schicken } = mitPasswort({ hoechstens: 2 });
  const r = await schicken(PASSWORT);
  assert.equal(r.status, 201, JSON.stringify(r.daten));
  assert.equal(r.daten['rolle'], 'buero');
  assert.equal(r.daten['mandant'], 'vorfuehrung');
  // The tenant has a device now: only for a password that allows it, and only up to its count.
  assert.equal(art(await schicken(PASSWORT)), 'entwickler-belegt');
  const { a: b, schicken: s2 } = mitPasswort({ hoechstens: 1, auchMitGeraeten: true });
  assert.equal((await s2(PASSWORT)).status, 201);
  assert.equal(art(await s2(PASSWORT)), 'entwickler-abgelaufen', 'used up');
  // Its end.
  const { a: c, schicken: s3 } = mitPasswort({ bis: 600 });
  c.uhr.ms += 601_000;
  assert.equal(art(await s3(PASSWORT)), 'entwickler-abgelaufen');
  void a;
  void b;
});

test('developer password: wrong text, wrong tenant or app, no key and no password configured are refused', async () => {
  const { a, schicken } = mitPasswort();
  assert.equal(art(await schicken('wrong')), 'entwickler-ungueltig');
  assert.equal(art(await schicken(PASSWORT, { mandant: 'andere-schule' })), 'entwickler-ungueltig');
  assert.equal(art(await schicken(PASSWORT, { mandant: 'standard' })), 'unlesbar');
  assert.equal(art(await schicken(PASSWORT, { app: 'gibtsnicht' })), 'app-unbekannt');
  assert.equal(art(await schicken(PASSWORT, { geraetSchluessel: undefined })), 'unlesbar');
  assert.equal(art(await schicken(PASSWORT, { app: undefined })), 'unlesbar');
  assert.equal(art(await schicken(PASSWORT, { rolle: 'buero' })), 'unlesbar');
  assert.equal(
    art(
      await post(
        a,
        'einschreiben',
        {
          passwort: PASSWORT,
          app: 'tkd',
          mandant: 'vorfuehrung',
          geraetSchluessel: neuesGeraet().paar.roh,
        },
        { herkunft: AZP },
      ),
    ),
    'herkunft',
  );
  const keins = aufbauen();
  assert.equal(
    art(
      await post(keins, 'einschreiben', {
        passwort: PASSWORT,
        app: 'tkd',
        mandant: 'vorfuehrung',
        geraetSchluessel: neuesGeraet().paar.roh,
      }),
    ),
    'entwickler-nicht-eingerichtet',
  );
  // `app` and `mandant` belong to the password; with a proof they are refused.
  const g = await einschreibenMitSchluessel(aufbauen(), neuesGeraet(), { app: 'tkd' });
  assert.equal(art(g), 'unlesbar');
});

test('developer password: tries are limited per app and hour', async () => {
  const { a, schicken } = mitPasswort({}, { passwortVersucheJeStunde: 2 });
  assert.equal(art(await schicken('a')), 'entwickler-ungueltig');
  assert.equal(art(await schicken('b')), 'entwickler-ungueltig');
  assert.equal(art(await schicken(PASSWORT)), 'zu-viele-einschreibungen');
  a.uhr.ms += 3_600_001;
  assert.equal((await schicken(PASSWORT)).status, 201);
});

test('invitation of a device: tenant and role come with it; used once, ten minutes', async () => {
  const a = aufbauen();
  const bue = await buero(a);
  const lb = await eingeladen(a, bue, 'lb:anna');
  assert.equal(lb.rolle, 'lb:anna');
  assert.equal(lb.mandant, '1');
  assert.match(lb.zugang ?? '', /^z1\./, 'tenant 1 also gets the old access, for old apps');
  const liste = await postNeu(a, bue, 'geraete', {});
  const zeile = (liste.daten['geraete'] as { geraet: string; von: string; rolle: string }[]).find(
    (x) => x.geraet === lb.geraet,
  );
  assert.equal(zeile?.von, bue.geraet, 'introduced by the inviting device');
  assert.equal(zeile?.rolle, 'lb:anna');
  // Once, ten minutes.
  const e = await postNeu(a, bue, 'einladen', {});
  const k = neuesGeraet().paar.roh;
  const einladung = e.daten['einladung'];
  assert.equal((await post(a, 'einschreiben', { einladung, geraetSchluessel: k })).status, 201);
  assert.equal(
    art(await post(a, 'einschreiben', { einladung, geraetSchluessel: k })),
    'verbraucht',
  );
  const spaet = await postNeu(a, bue, 'einladen', {});
  a.uhr.ms += 601_000;
  assert.equal(
    art(
      await post(a, 'einschreiben', { einladung: spaet.daten['einladung'], geraetSchluessel: k }),
    ),
    'einladung-abgelaufen',
  );
  // The new device cannot choose its role, nor change the invitation.
  const frisch = await postNeu(a, bue, 'einladen', { rolle: 'ohne' });
  assert.equal(
    art(
      await post(a, 'einschreiben', {
        einladung: frisch.daten['einladung'],
        geraetSchluessel: k,
        rolle: 'buero',
      }),
    ),
    'unlesbar',
  );
  const geaendert = (frisch.daten['einladung'] as string).replace('.ohne.', '.buero.');
  assert.equal(
    art(await post(a, 'einschreiben', { einladung: geaendert, geraetSchluessel: k })),
    'einladung-ungueltig',
  );
  // An invitation needs the key: a tenant's device has no old access.
  const ohneSchluessel = await postNeu(a, bue, 'einladen', { rolle: 'ohne' });
  assert.equal(
    (await post(a, 'einschreiben', { einladung: ohneSchluessel.daten['einladung'] })).status,
    201,
    'tenant 1 may still enrol without a key (old app)',
  );
});

test('an invitation hands on the tenant of whoever invites and cannot change it', async () => {
  const e = entwicklerPaar();
  const a = aufbauen({ entwickler: { schluessel: [e.roh] } });
  const gruender = neuesGeraet();
  await einschreibenMitGruender(a, gruender, e, 'schule-2');
  const gast = await eingeladen(a, gruender, 'ohne');
  assert.equal(gast.mandant, 'schule-2');
  assert.match(gast.zertifikat ?? '', /^c1\.tkd\.schule-2\./);
  assert.equal(gast.zugang, undefined);
  // Without a key there is no way into tenant 2.
  const einl = await postNeu(a, gruender, 'einladen', { rolle: 'ohne' });
  assert.equal(
    art(await post(a, 'einschreiben', { einladung: einl.daten['einladung'] })),
    'unlesbar',
  );
});

test('who may invite whom: the office any role, a `lb:<id>` device only its own, others nobody', async () => {
  const a = aufbauen();
  const bue = await buero(a);
  const lb = await eingeladen(a, bue, 'lb:anna');
  const ohne = await eingeladen(a, bue, 'ohne');
  assert.equal(art(await postNeu(a, lb, 'einladen', { rolle: 'buero' })), 'rolle-nicht-erlaubt');
  assert.equal(art(await postNeu(a, lb, 'einladen', { rolle: 'lb:berta' })), 'rolle-nicht-erlaubt');
  assert.equal(art(await postNeu(a, lb, 'einladen', { rolle: 'ohne' })), 'rolle-nicht-erlaubt');
  assert.equal((await postNeu(a, lb, 'einladen', { rolle: 'lb:anna' })).status, 201);
  assert.equal((await postNeu(a, lb, 'einladen', {})).status, 201, 'its own role is the default');
  assert.equal(art(await postNeu(a, ohne, 'einladen', {})), 'rolle-nicht-erlaubt');
  assert.equal(art(await postNeu(a, ohne, 'einladen', { rolle: 'ohne' })), 'rolle-nicht-erlaubt');
  assert.equal(art(await postNeu(a, bue, 'einladen', { rolle: 'Buero' })), 'unlesbar');
  // A device of the old procedure keeps its old invitation and may not name a role.
  const alt = await einschreiben(a);
  assert.equal(
    art(await post(a, 'einladen', { rolle: 'ohne' }, { zugang: alt.zugang })),
    'unlesbar',
  );
});

test('invitations are off for an app that turned them off, also the new ones', async () => {
  const a = aufbauen({ einladenAzp: false });
  const bue = await buero(a, 'azp');
  assert.equal(art(await postNeu(a, bue, 'einladen', {}, { herkunft: AZP })), 'einladen-aus');
});

test('blocking: the office blocks any device of its tenant; the blocked one is refused everywhere and is not „expired“', async () => {
  const a = aufbauen();
  const bue = await buero(a);
  const lb = await eingeladen(a, bue, 'lb:anna');
  assert.equal((await postNeu(a, lb, 'ping', {})).status, 200);
  const s = await postNeu(a, bue, 'sperren', { geraet: lb.geraet });
  assert.equal(s.status, 200);
  assert.deepEqual(s.daten, { geraet: lb.geraet, gesperrt: true });
  for (const endpunkt of ['ping', 'erneuern', 'abholen', 'einladen', 'ablegen', 'geraete']) {
    const r = await postNeu(a, lb, endpunkt, {});
    assert.equal(art(r), 'gesperrt', endpunkt);
    assert.equal(r.status, 403);
  }
  // The office itself goes on.
  assert.equal((await postNeu(a, bue, 'ping', {})).status, 200);
  // An invitation of a blocked device is no good either.
  const e = await postNeu(a, bue, 'einladen', { rolle: 'lb:anna' });
  const frisch = await eingeladen(a, bue, 'lb:berta');
  const e2 = await postNeu(a, frisch, 'einladen', {});
  await postNeu(a, bue, 'sperren', { geraet: frisch.geraet });
  assert.equal(
    art(
      await post(a, 'einschreiben', {
        einladung: e2.daten['einladung'],
        geraetSchluessel: neuesGeraet().paar.roh,
      }),
    ),
    'einladung-ungueltig',
  );
  assert.equal(
    (
      await post(a, 'einschreiben', {
        einladung: e.daten['einladung'],
        geraetSchluessel: neuesGeraet().paar.roh,
      })
    ).status,
    201,
  );
});

test('blocking reaches a device with the old access, too', async () => {
  const a = aufbauen();
  const bue = await buero(a);
  const alt = await einschreiben(a);
  assert.equal((await post(a, 'ping', {}, { zugang: alt.zugang })).status, 200);
  assert.equal((await postNeu(a, bue, 'sperren', { geraet: alt.geraet })).status, 200);
  const r = await post(a, 'ping', {}, { zugang: alt.zugang });
  assert.equal(art(r), 'gesperrt');
  assert.equal(art(await post(a, 'erneuern', {}, { zugang: alt.zugang })), 'gesperrt');
  assert.equal(art(await post(a, 'abholen', {}, { zugang: alt.zugang })), 'gesperrt');
});

test('blocking: a `lb:<id>` device blocks its own second devices and itself, never the office nor another person', async () => {
  const a = aufbauen();
  const bue = await buero(a);
  const anna = await eingeladen(a, bue, 'lb:anna');
  const anna2 = await eingeladen(a, anna, undefined);
  assert.equal(anna2.rolle, 'lb:anna');
  const berta = await eingeladen(a, bue, 'lb:berta');
  assert.equal(
    art(await postNeu(a, anna, 'sperren', { geraet: bue.geraet })),
    'rolle-nicht-erlaubt',
  );
  assert.equal(
    art(await postNeu(a, anna, 'sperren', { geraet: berta.geraet })),
    'rolle-nicht-erlaubt',
  );
  assert.equal(
    art(await postNeu(a, anna, 'sperren', { geraet: `geraet-${'0'.repeat(32)}` })),
    'rolle-nicht-erlaubt',
    'an unknown device is no business of a `lb` device',
  );
  assert.equal((await postNeu(a, berta, 'ping', {})).status, 200);
  assert.equal((await postNeu(a, anna, 'sperren', { geraet: anna2.geraet })).status, 200);
  assert.equal(art(await postNeu(a, anna2, 'ping', {})), 'gesperrt');
  // Itself, e.g. when lost.
  assert.equal((await postNeu(a, anna, 'sperren', { geraet: anna.geraet })).status, 200);
  assert.equal(art(await postNeu(a, anna, 'ping', {})), 'gesperrt');
  // A device without role blocks only itself.
  const ohne = await eingeladen(a, bue, 'ohne');
  assert.equal(
    art(await postNeu(a, ohne, 'sperren', { geraet: bue.geraet })),
    'rolle-nicht-erlaubt',
  );
  assert.equal((await postNeu(a, ohne, 'sperren', { geraet: ohne.geraet })).status, 200);
  // A device of the old access has no role and may not block or look.
  const alt = await einschreiben(a);
  assert.equal(
    art(await post(a, 'sperren', { geraet: bue.geraet }, { zugang: alt.zugang })),
    'rolle-nicht-erlaubt',
  );
  assert.equal(art(await post(a, 'geraete', {}, { zugang: alt.zugang })), 'rolle-nicht-erlaubt');
  // Strict reading.
  assert.equal(art(await postNeu(a, bue, 'sperren', {})), 'unlesbar');
  assert.equal(art(await postNeu(a, bue, 'sperren', { geraet: 'x' })), 'unlesbar');
  assert.equal(art(await postNeu(a, bue, 'sperren', { geraet: bue.geraet, mehr: 1 })), 'unlesbar');
});

test('blocking holds in another tenant only for that tenant; the office of one tenant does not block in another', async () => {
  const e = entwicklerPaar();
  const a = aufbauen({ entwickler: { schluessel: [e.roh] } });
  const eins = await buero(a);
  const zwei = neuesGeraet();
  await einschreibenMitGruender(a, zwei, e, '2');
  const gast = await eingeladen(a, zwei, 'ohne');
  assert.equal(art(await postNeu(a, eins, 'sperren', { geraet: gast.geraet })), undefined);
  // It is blocked in tenant 1's list (a harmless id there), but the device of tenant 2 is not.
  assert.equal((await postNeu(a, gast, 'ping', {})).status, 200);
});

test('the list of blocked devices and the blocks per hour are limited', async () => {
  const a = aufbauen({ grenzen: { sperrlisteJeMandant: 2, sperrenJeStunde: 3 } });
  const bue = await buero(a);
  const id = (n: number) => `geraet-${n.toString(16).padStart(32, '0')}`;
  assert.equal((await postNeu(a, bue, 'sperren', { geraet: id(1) })).status, 200);
  assert.equal(
    (await postNeu(a, bue, 'sperren', { geraet: id(1) })).status,
    200,
    'again is no new entry',
  );
  assert.equal((await postNeu(a, bue, 'sperren', { geraet: id(2) })).status, 200);
  assert.equal(art(await postNeu(a, bue, 'sperren', { geraet: id(3) })), 'zu-viele-einladungen');
  a.uhr.ms += 3_600_001;
  assert.equal(art(await postNeu(a, bue, 'sperren', { geraet: id(3) })), 'sperrliste-voll');
  assert.equal(a.t.zaehlstand().gesperrt, 2);
});

test('a block is held 90 days and tidied up after; the tenant list tidies with it', async () => {
  const a = aufbauen();
  const bue = await buero(a);
  const ziel = `geraet-${'1'.repeat(32)}`;
  await postNeu(a, bue, 'sperren', { geraet: ziel });
  assert.equal(a.t.zaehlstand().gesperrt, 1);
  a.uhr.ms += 89 * 86_400_000;
  a.t.aufraeumen();
  assert.equal(a.t.zaehlstand().gesperrt, 1);
  a.uhr.ms += 2 * 86_400_000;
  a.t.aufraeumen();
  assert.equal(a.t.zaehlstand().gesperrt, 0);
});

test('the device list: the office sees its tenant, a `lb` device its own, others themselves', async () => {
  const a = aufbauen();
  const bue = await buero(a);
  const anna = await eingeladen(a, bue, 'lb:anna');
  const anna2 = await eingeladen(a, anna, undefined);
  const berta = await eingeladen(a, bue, 'lb:berta');
  const ids = async (g: Neugeraet) =>
    ((await postNeu(a, g, 'geraete', {})).daten['geraete'] as { geraet: string }[])
      .map((x) => x.geraet)
      .sort();
  assert.deepEqual(
    await ids(bue),
    [bue.geraet, anna.geraet, anna2.geraet, berta.geraet].sort() as string[],
  );
  assert.deepEqual(await ids(anna), [anna.geraet, anna2.geraet].sort() as string[]);
  assert.deepEqual(await ids(berta), [berta.geraet]);
  const liste = await postNeu(a, bue, 'geraete', {});
  assert.equal(liste.daten['hoechstens'], 50);
  for (const z of liste.daten['geraete'] as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(z).sort(), [
      'geraet',
      'rolle',
      'seit',
      'verfahren',
      'von',
      'zuletzt',
    ]);
  }
  assert.equal(art(await postNeu(a, bue, 'geraete', { x: 1 })), 'unlesbar');
});

test('a tenant holds at most 50 devices (the limit of GRENZEN)', async () => {
  const a = aufbauen({ grenzen: { geraeteJeMandant: 2 } });
  const bue = await buero(a);
  await eingeladen(a, bue, 'ohne');
  const e = await postNeu(a, bue, 'einladen', { rolle: 'ohne' });
  assert.equal(
    art(
      await post(a, 'einschreiben', {
        einladung: e.daten['einladung'],
        geraetSchluessel: neuesGeraet().paar.roh,
      }),
    ),
    'geraete-voll',
  );
  // A refused try does not use up the invitation; a place frees when a device is not heard of.
  a.uhr.ms += 91 * 86_400_000;
  a.t.aufraeumen();
  assert.equal(a.t.zaehlstand().geraete, 0);
  // The tenant of the other app has its own count.
  const alt = aufbauen({ grenzen: { geraeteJeMandant: 1 } });
  await einschreiben(alt, 'tkd');
  assert.equal((await einschreiben(alt, 'azp')).geraet.startsWith('geraet-'), true);
  await assert.rejects(einschreiben(alt, 'tkd'), /geraete-voll/);
});

test('the protocol version of the app is remembered per device, nothing else about the request', async () => {
  const a = aufbauen();
  const bue = await buero(a);
  await postNeu(a, bue, 'ping', {}, { p: 3 });
  const liste = await postNeu(a, bue, 'geraete', {}, { p: 3 });
  const eigene = (liste.daten['geraete'] as { geraet: string; p?: number }[]).find(
    (x) => x.geraet === bue.geraet,
  );
  assert.equal(eigene?.p, 3);
  // Only up to three digits count.
  await postNeu(a, bue, 'ping', {}, { p: 1234 });
  const danach = await postNeu(a, bue, 'geraete', {});
  assert.equal(
    (danach.daten['geraete'] as { geraet: string; p?: number }[]).find(
      (x) => x.geraet === bue.geraet,
    )?.p,
    undefined,
  );
});

test('renewing: a certificate renews itself with the same key, tenant and role and claims nothing', async () => {
  const a = aufbauen();
  const bue = await buero(a);
  const lb = await eingeladen(a, bue, 'lb:anna');
  a.uhr.ms += 35 * 86_400_000;
  const r = await postNeu(a, lb, 'erneuern', {});
  assert.equal(r.status, 200);
  const neu = r.daten['zertifikat'] as string;
  assert.notEqual(neu, lb.zertifikat);
  assert.equal(
    neu.split('.').slice(0, 6).join('.'),
    (lb.zertifikat ?? '').split('.').slice(0, 6).join('.'),
  );
  assert.equal(art(await postNeu(a, lb, 'erneuern', { rolle: 'buero' })), 'unlesbar');
  assert.equal(
    art(await postNeu(a, lb, 'erneuern', { geraetSchluessel: neuesGeraet().paar.roh })),
    'unlesbar',
  );
  lb.zertifikat = neu;
  assert.equal((await postNeu(a, lb, 'ping', {})).daten['rolle'], 'lb:anna');
  // The old one still holds until its end (like an old access).
});

test('renewing an old access with a key makes it a certificate (the step of the migration)', async () => {
  const a = aufbauen();
  const alt = await einschreiben(a);
  const g = neuesGeraet();
  const r = await post(
    a,
    'erneuern',
    { geraetSchluessel: g.paar.roh, rolle: 'lb:anna' },
    { zugang: alt.zugang },
  );
  assert.equal(r.status, 200);
  assert.match(r.daten['zugang'] as string, /^z1\./);
  assert.match(r.daten['zertifikat'] as string, /^c1\.tkd\.1\./);
  assert.equal(r.daten['rolle'], 'lb:anna');
  // Without a key a role is nothing to set; a bad key or role is unreadable.
  assert.equal(
    art(await post(a, 'erneuern', { rolle: 'lb:anna' }, { zugang: alt.zugang })),
    'unlesbar',
  );
  assert.equal(
    art(await post(a, 'erneuern', { geraetSchluessel: 'nope' }, { zugang: alt.zugang })),
    'unlesbar',
  );
  assert.equal(
    art(
      await post(
        a,
        'erneuern',
        { geraetSchluessel: g.paar.roh, rolle: 'Chef' },
        { zugang: alt.zugang },
      ),
    ),
    'unlesbar',
  );
  g.zertifikat = r.daten['zertifikat'] as string;
  merken(g, { status: 201, kopf: {}, daten: { ...r.daten, geraet: alt.geraet } });
  assert.equal((await postNeu(a, g, 'ping', {})).daten['geraet'], alt.geraet);
});

test('enrolling: a bad key, two ways at once, or an unknown field is unreadable', async () => {
  const a = aufbauen();
  const herkunft = { herkunft: TKD };
  const g = neuesGeraet();
  const mit = (zusatz: Record<string, unknown>) =>
    einschreibenMitSchluessel(a, neuesGeraet(), zusatz).then((r) => art(r));
  assert.equal(await mit({ geraetSchluessel: 'kurz' }), 'unlesbar');
  assert.equal(
    await mit({ geraetSchluessel: 'A'.repeat(87) }),
    'unlesbar',
    'not a point on the curve',
  );
  assert.equal(await mit({ rolle: 'chef' }), 'unlesbar');
  assert.equal(await mit({ mehr: 1 }), 'unlesbar');
  assert.equal(
    art(
      await post(
        a,
        'einschreiben',
        { nachweis: 'x', gruender: 'y', geraetSchluessel: g.paar.roh },
        herkunft,
      ),
    ),
    'unlesbar',
  );
  assert.equal(
    art(await post(a, 'einschreiben', { geraetSchluessel: g.paar.roh }, herkunft)),
    'unlesbar',
  );
});

test('`streng` for a tenant: only the new procedure; the old gets „new version needed“, not „blocked“', async () => {
  const e = entwicklerPaar();
  const a = aufbauen({ streng: { tkd: ['1'] }, entwickler: { schluessel: [e.roh] } });
  // The login script's proof is the old procedure: refused for tenant 1.
  const alt = await post(
    a,
    'einschreiben',
    {
      nachweis: (await import('./hilfen.ts')).nachweis(a.paar, {
        v: 1,
        app: 'tkd',
        bis: jetztS(a) + 300,
        n: (await import('./hilfen.ts')).zufallN(),
      }),
    },
    { herkunft: TKD },
  );
  assert.equal(art(alt), 'neue-fassung-noetig');
  assert.equal(alt.status, 426);
  // Also with a key (a new app on the old way) and with the old invitation.
  const neuMitNachweis = await einschreibenMitSchluessel(a, neuesGeraet());
  assert.equal(art(neuMitNachweis), 'neue-fassung-noetig');
  // The new ways go on, and issue no old access.
  const g = neuesGeraet();
  const r = await einschreibenMitGruender(a, g, e, '1');
  assert.equal(r.status, 201, JSON.stringify(r.daten));
  assert.equal(g.zugang, undefined);
  assert.equal((await postNeu(a, g, 'ping', {})).status, 200);
  const gast = await eingeladen(a, g, 'ohne');
  assert.equal(gast.zugang, undefined);
  assert.equal((await postNeu(a, gast, 'ping', {})).status, 200);
  // Without a key there is nothing to issue.
  const e2 = await postNeu(a, g, 'einladen', { rolle: 'ohne' });
  assert.equal(
    art(await post(a, 'einschreiben', { einladung: e2.daten['einladung'] })),
    'unlesbar',
  );
  // The other app, and other tenants of this app, are not touched.
  assert.equal((await einschreiben(a, 'azp')).zugang.startsWith('z1.azp.'), true);
});

test('`streng` turns a device with an old access away at once, also one issued before', async () => {
  // Built in two steps: the same secret, once without and once with `streng`.
  const vorher = aufbauen();
  const alt = await einschreiben(vorher);
  const t = aufbauen({ streng: { tkd: ['1'] } });
  // A different Treffpunkt has another secret: build the access with this one's.
  const { zugangAusstellen } = await import('../src/zugang.ts');
  const z = zugangAusstellen(t.schluessel, 'tkd', alt.geraet, jetztS(t));
  const r = await post(t, 'ping', {}, { zugang: z.zugang });
  assert.equal(art(r), 'neue-fassung-noetig');
  assert.equal(r.status, 426);
  // A certificate of the same tenant is fine.
  const g = neuesGeraet();
  const c = zertifikatAusstellen(
    t.schluessel,
    { app: 'tkd', mandant: '1', geraet: alt.geraet, rolle: 'ohne', schluessel: g.paar.roh },
    jetztS(t),
  );
  g.zertifikat = c.zertifikat;
  assert.equal((await postNeu(t, g, 'ping', {})).status, 200);
});

test('the evaluation: per tenant how many devices use which procedure, when the old one was last used; only for the developer', async () => {
  const e = entwicklerPaar();
  const a = aufbauen({ entwickler: { schluessel: [e.roh] }, streng: { azp: ['7'] } });
  const bue = await buero(a);
  const alt = await einschreiben(a);
  await post(a, 'ping', {}, { zugang: alt.zugang });
  a.uhr.ms += 30_000;
  await postNeu(a, bue, 'ping', {});
  const ticket = auswertungAusstellen(e.privat, jetztS(a) + 300);
  const r = await post(a, 'auswertung', { ticket }, { herkunft: null });
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  assert.equal(r.kopf['Access-Control-Allow-Origin'], undefined);
  const zeile = (r.daten['mandanten'] as Record<string, unknown>[]).find((m) => m['app'] === 'tkd');
  assert.deepEqual(zeile, {
    app: 'tkd',
    mandant: '1',
    geraete: 2,
    neu: 1,
    alt: 1,
    gesperrt: 0,
    altLetzteVorS: 30,
    streng: false,
  });
  assert.equal(typeof r.daten['laufzeitS'], 'number');
  // Once, and not with another key, nor expired, nor without a configured key, nor with an extra field.
  assert.equal(art(await post(a, 'auswertung', { ticket }, { herkunft: null })), 'verbraucht');
  assert.equal(
    art(
      await post(
        a,
        'auswertung',
        { ticket: auswertungAusstellen(schluesselpaar().privat, jetztS(a) + 300) },
        { herkunft: null },
      ),
    ),
    'entwickler-ungueltig',
  );
  assert.equal(
    art(
      await post(
        a,
        'auswertung',
        { ticket: auswertungAusstellen(e.privat, jetztS(a) - 1) },
        { herkunft: null },
      ),
    ),
    'entwickler-abgelaufen',
  );
  assert.equal(art(await post(a, 'auswertung', { ticket: 1 }, { herkunft: null })), 'unlesbar');
  assert.equal(
    art(await post(aufbauen(), 'auswertung', { ticket }, { herkunft: null })),
    'entwickler-nicht-eingerichtet',
  );
  // From a page of a known app it is allowed as any request; from a foreign page it is not.
  const mitHerkunft = await post(a, 'auswertung', {
    ticket: auswertungAusstellen(e.privat, jetztS(a) + 300),
  });
  assert.equal(mitHerkunft.status, 200);
  assert.equal(
    art(
      await post(
        a,
        'auswertung',
        { ticket: auswertungAusstellen(e.privat, jetztS(a) + 300) },
        { herkunft: FREMD },
      ),
    ),
    'herkunft',
  );
});

test('the evaluation never names a device and the counts hold only numbers', async () => {
  const e = entwicklerPaar();
  const a = aufbauen({ entwickler: { schluessel: [e.roh] } });
  const bue = await buero(a);
  const r = await post(
    a,
    'auswertung',
    { ticket: auswertungAusstellen(e.privat, jetztS(a) + 300) },
    { herkunft: null },
  );
  assert.equal(JSON.stringify(r.daten).includes(bue.geraet ?? 'x'), false);
  assert.equal(JSON.stringify(a.t.zaehlstand()).includes(bue.geraet ?? 'x'), false);
});

test('a device nobody has heard from is tidied out of the register after 90 days', async () => {
  const a = aufbauen();
  await buero(a);
  assert.equal(a.t.zaehlstand().geraete, 1);
  a.uhr.ms += 89 * 86_400_000;
  a.t.aufraeumen();
  assert.equal(a.t.zaehlstand().geraete, 1);
  a.uhr.ms += 2 * 86_400_000;
  a.t.aufraeumen();
  assert.equal(a.t.zaehlstand().geraete, 0);
});

test("preflight allows the new headers; a missing signature header is not the browser's doing", () => {
  const a = aufbauen();
  const r = a.t.vorpruefen({
    methode: 'OPTIONS',
    pfad: '/v1/ping',
    kopf: { origin: TKD, 'access-control-request-method': 'POST' },
  });
  assert.ok('antwort' in r);
  assert.match(r.antwort.kopf['Access-Control-Allow-Headers'] ?? '', /x-treffpunkt-signatur/);
  assert.match(r.antwort.kopf['Access-Control-Allow-Headers'] ?? '', /x-treffpunkt-p/);
});

test('a device that said it is the office on the old access still cannot block or list with that access', async () => {
  const a = aufbauen();
  const bue = await buero(a);
  const alt = await einschreiben(a);
  const g = neuesGeraet();
  const r = await post(
    a,
    'erneuern',
    { geraetSchluessel: g.paar.roh, rolle: 'buero' },
    { zugang: alt.zugang },
  );
  assert.equal(r.status, 200);
  // Its old access is a bearer value anybody could hold: it never blocks, whatever role it was given.
  assert.equal(
    art(await post(a, 'sperren', { geraet: bue.geraet }, { zugang: alt.zugang })),
    'rolle-nicht-erlaubt',
  );
  assert.equal(art(await post(a, 'geraete', {}, { zugang: alt.zugang })), 'rolle-nicht-erlaubt');
  assert.equal((await postNeu(a, bue, 'ping', {})).status, 200, 'the office was not blocked');
});

test('a certificate lives 60 days: after that it is expired, before that a renewal moves it on', async () => {
  const a = aufbauen();
  const bue = await buero(a);
  a.uhr.ms += 59 * 86_400_000;
  assert.equal((await postNeu(a, bue, 'erneuern', {})).status, 200, 'renewing is still possible');
  a.uhr.ms += 2 * 86_400_000;
  const r = await postNeu(a, bue, 'ping', {});
  assert.equal(art(r), 'zugang-abgelaufen');
  assert.equal(r.status, 401);
});

test('a block is not renewed away: a blocked device cannot renew and drops out by itself', async () => {
  const a = aufbauen();
  const bue = await buero(a);
  const lb = await eingeladen(a, bue, 'lb:anna');
  await postNeu(a, bue, 'sperren', { geraet: lb.geraet });
  assert.equal(art(await postNeu(a, lb, 'erneuern', {})), 'gesperrt');
});

test('the ring of secrets: an old secret still judges, only the current one signs, and removing it ends them', async () => {
  const alt = aufbauen();
  const bue = await buero(alt);
  const zugang = (await einschreiben(alt)).zugang;
  const e = await postNeu(alt, bue, 'einladen', { rolle: 'ohne' });
  const e1 = await post(alt, 'einladen', {}, { zugang });
  assert.equal(e1.status, 201);
  // The same Treffpunkt after the change: a new current secret, the old one entered as „alt“.
  const { treffpunktAnlegen } = await import('../src/treffpunkt.ts');
  const neuesGeheimnis = Buffer.alloc(32, 5);
  const bisMs = alt.uhr.ms + 30 * 86_400_000;
  const bauen = (mitRing: boolean) => {
    const t = treffpunktAnlegen({
      schluessel: neuesGeheimnis,
      ...(mitRing ? { schluesselAlt: [{ schluessel: alt.schluessel, bisMs: bisMs }] } : {}),
      apps: alt.apps,
      jetzt: () => alt.uhr.ms + alt.uhr.wand,
      takt: () => alt.uhr.ms - Date.UTC(2026, 10, 15, 12) + 5000,
      senden: async () => 201,
    });
    const b: Aufbau = { ...alt, schluessel: neuesGeheimnis, t };
    return b;
  };
  const mit = bauen(true);
  // What the old secret signed still holds: certificate, old access, both invitations.
  assert.equal((await postNeu(mit, bue, 'ping', {})).status, 200);
  assert.equal((await post(mit, 'ping', {}, { zugang })).status, 200);
  assert.equal(
    (
      await post(mit, 'einschreiben', {
        einladung: e.daten['einladung'],
        geraetSchluessel: neuesGeraet().paar.roh,
      })
    ).status,
    201,
  );
  assert.equal((await post(mit, 'einschreiben', { einladung: e1.daten['einladung'] })).status, 201);
  // A genuine but expired access of the current secret says „expired“, not „invalid“, whatever
  // the ring holds after it.
  const { zugangAusstellen } = await import('../src/zugang.ts');
  const abgelaufen = zugangAusstellen(
    neuesGeheimnis,
    'tkd',
    `geraet-${'b'.repeat(32)}`,
    jetztS(alt) - 91 * 86_400,
  );
  assert.equal(
    art(await post(mit, 'ping', {}, { zugang: abgelaufen.zugang })),
    'zugang-abgelaufen',
  );
  // Renewing signs with the current secret …
  const erneuert = await postNeu(mit, bue, 'erneuern', {});
  assert.equal(erneuert.status, 200);
  bue.zertifikat = erneuert.daten['zertifikat'] as string;
  const z2 = await post(mit, 'erneuern', {}, { zugang });
  // … so that, once the old secret is removed, the renewed ones still hold and the others do not.
  // The old secret ends by itself at its date, without anyone removing it.
  const abgelaufenesDatum = bauen(true);
  alt.uhr.ms = bisMs - 1000;
  assert.equal(
    (await post(abgelaufenesDatum, 'ping', {}, { zugang: z2.daten['zugang'] as string })).status,
    200,
  );
  assert.equal((await post(abgelaufenesDatum, 'ping', {}, { zugang })).status, 200);
  alt.uhr.ms = bisMs + 1000;
  assert.equal(art(await post(abgelaufenesDatum, 'ping', {}, { zugang })), 'zugang-ungueltig');
  alt.uhr.ms = bisMs - 1000;
  const ohne = bauen(false);
  assert.equal((await postNeu(ohne, bue, 'ping', {})).status, 200);
  assert.equal(
    (await post(ohne, 'ping', {}, { zugang: z2.daten['zugang'] as string })).status,
    200,
  );
  assert.equal(art(await post(ohne, 'ping', {}, { zugang })), 'zugang-ungueltig');
  const altesZert: Neugeraet = { paar: bue.paar };
  altesZert.zertifikat = (await postNeu(alt, bue, 'erneuern', {})).daten['zertifikat'] as string;
  assert.equal(art(await postNeu(ohne, altesZert, 'ping', {})), 'zugang-ungueltig');
});
