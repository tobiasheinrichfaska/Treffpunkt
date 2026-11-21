// The container's only output: one JSON line per event. By rule (plan § 5) it never holds an IP
// address, a device id, an access, a proof or any content — only counts and kinds of refusal.

export type Ereignis =
  | { readonly ereignis: 'start'; readonly apps: readonly string[]; readonly port: number }
  | { readonly ereignis: 'zaehler'; readonly [feld: string]: unknown }
  | { readonly ereignis: 'ende' }
  | { readonly ereignis: 'konfiguration'; readonly fehler: string }
  | { readonly ereignis: 'intern'; readonly fehler: string };

export type Schreiber = (zeile: string) => void;

export function protokollieren(e: Ereignis, schreiben: Schreiber = console.log): void {
  schreiben(JSON.stringify({ zeit: new Date().toISOString(), ...e }));
}
