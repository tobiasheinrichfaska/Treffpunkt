// What the probe takes for `--einladung`: the invitation itself (`e1.…`), or the link a device of
// the Trainerbuch shows for a new device (`…#neu=<base64url JSON>`), whose field `tp` carries it.
// Read strictly: anything else is refused, never sent on.
const EINLADUNG =
  /^e1\.[a-z][a-z0-9]{1,15}\.[1-9][0-9]{0,11}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;
const FRAGMENT = '#neu=';

export function einladungAus(text: string): string | undefined {
  const t = text.trim();
  if (EINLADUNG.test(t)) return t;
  const stelle = t.indexOf(FRAGMENT);
  if (stelle < 0) return undefined;
  const teil = t.slice(stelle + FRAGMENT.length);
  if (teil.length > 4000 || !/^[A-Za-z0-9_-]+$/.test(teil)) return undefined;
  let inhalt: unknown;
  try {
    inhalt = JSON.parse(Buffer.from(teil, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof inhalt !== 'object' || inhalt === null || Array.isArray(inhalt)) return undefined;
  const tp = (inhalt as Record<string, unknown>)['tp'];
  return typeof tp === 'string' && EINLADUNG.test(tp) ? tp : undefined;
}
