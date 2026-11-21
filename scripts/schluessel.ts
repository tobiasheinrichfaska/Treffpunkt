// `npm run schluessel`: makes the Treffpunkt's secret (32 random bytes, base64url). Tobias runs it
// on his own PC and enters the value at bunny as TREFFPUNKT_SCHLUESSEL — never in a repo or a chat.
// A new value makes every access and invitation invalid: all devices enrol again.
import { randomBytes } from 'node:crypto';

console.log('Neuer Geheimwert für den Treffpunkt (nur bei bunny eintragen, nirgends sonst):');
console.log('');
console.log(`TREFFPUNKT_SCHLUESSEL=${randomBytes(32).toString('base64url')}`);
console.log('');
console.log(
  'Achtung: Ein neuer Wert macht alle Zugänge ungültig, alle Geräte schreiben sich neu ein.',
);
