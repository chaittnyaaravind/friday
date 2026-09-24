/** Short random ids for document nodes (works in browser and server). */
export function randomId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}
