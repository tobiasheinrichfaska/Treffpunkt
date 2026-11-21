// Start of the container: reads the settings (fail closed), listens, runs the timers, ends on
// SIGTERM. The parts are in src/start.ts (tested there); this file only puts them together.
import { serverAnlegen } from './http.ts';
import { KonfigurationFehler } from './konfiguration.ts';
import { protokollieren } from './protokoll.ts';
import {
  einstellungenLesen,
  treffpunktFuer,
  zeitgeberStarten,
  type Einstellungen,
} from './start.ts';

let einstellungen: Einstellungen;
try {
  einstellungen = einstellungenLesen(process.env);
} catch (e) {
  const text = e instanceof KonfigurationFehler ? e.message : 'Einstellungen nicht lesbar';
  protokollieren({ ereignis: 'konfiguration', fehler: text });
  process.exit(1);
}
const treffpunkt = treffpunktFuer(einstellungen);
const server = serverAnlegen(treffpunkt);
const stoppen = zeitgeberStarten(treffpunkt);
const beenden = (): void => {
  protokollieren({ ereignis: 'ende' });
  stoppen();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', beenden);
process.on('SIGINT', beenden);
const { port, apps } = einstellungen;
server.listen(port, () => protokollieren({ ereignis: 'start', apps: [...apps.keys()], port }));
