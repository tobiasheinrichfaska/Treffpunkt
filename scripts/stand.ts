// Which image runs: `/gesund` names the full commit (40 hex characters); people and documents give
// it short. A given commit of at least 7 hex characters fits if the running one starts with it.
export function standPasst(gegeben: string, gemeldet: string): boolean {
  const kurz = gegeben.trim().toLowerCase();
  return (
    /^[0-9a-f]{7,40}$/.test(kurz) && /^[0-9a-f]{40}$/.test(gemeldet) && gemeldet.startsWith(kurz)
  );
}
