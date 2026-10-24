/** One-time codes and bearer tokens: random, shown once, stored only as a sha256. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** 8 characters, no look-alikes (0/O, 1/I/L): typed or tapped once to link Telegram. */
export function linkCode(): string {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return [...randomBytes(8)].map((b) => A[b % A.length]).join("");
}
export const bridgeToken = () => `fb_${randomBytes(24).toString("base64url")}`;
export function sameSecret(got: string | null, want: string | undefined): boolean {
  if (!got || !want) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
