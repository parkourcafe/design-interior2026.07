import { sha256Hex } from "@/lib/project-intelligence/delivery/projectceo/command-contract";

/**
 * A UUID derived from the declared content of a document.
 *
 * Identity has to be a function of what the human typed: the same paper
 * declared twice is one physical record, not two. A random id would quietly
 * create a second record for the same paper on every remount or retry.
 *
 * The shape is a v4-formatted UUID because that is what the command contract
 * accepts; the value is deterministic rather than random, which is the whole
 * point — the format carries no promise of randomness to anyone downstream.
 */
export function recordIdFromContent(parts: readonly string[]): string {
  const digest = sha256Hex(parts.map((part) => part.trim()).join("|"));
  const variant = ((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}
