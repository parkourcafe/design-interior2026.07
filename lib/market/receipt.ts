import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  resolveMarket,
  type DataCellId,
  type Market,
  type MarketSignals,
  type RoutingBasis,
} from "./contract";

export const MARKET_ROUTING_COOKIE = "remhaos-market-routing";
const RECEIPT_VERSION = 1;
const RECEIPT_TTL_SECONDS = 60 * 60;

export interface MarketRoutingReceipt {
  readonly version: 1;
  readonly market: Market;
  readonly cellCode: DataCellId;
  readonly routingBasis: RoutingBasis;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly nonce: string;
}

export class MarketRoutingReceiptError extends Error {
  constructor(message: "routing_receipt_invalid" | "routing_receipt_expired" | "routing_receipt_secret_missing") {
    super(message);
  }
}

function routingSecret(): string {
  const secret = process.env.REGIONAL_ROUTING_RECEIPT_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new MarketRoutingReceiptError("routing_receipt_secret_missing");
  }
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signature(payload: string): string {
  return createHmac("sha256", routingSecret()).update(payload).digest("base64url");
}

function validReceipt(value: unknown): value is MarketRoutingReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<MarketRoutingReceipt>;
  if (receipt.version !== RECEIPT_VERSION || typeof receipt.issuedAt !== "number"
    || typeof receipt.expiresAt !== "number" || typeof receipt.nonce !== "string"
    || !Number.isSafeInteger(receipt.issuedAt) || !Number.isSafeInteger(receipt.expiresAt)
    || receipt.expiresAt - receipt.issuedAt !== RECEIPT_TTL_SECONDS
    || !/^[A-Za-z0-9_-]{22}$/.test(receipt.nonce)
    || !receipt.routingBasis || typeof receipt.routingBasis !== "object") return false;

  const basis = receipt.routingBasis as Partial<RoutingBasis>;
  const declaredMarket = basis.declaredMarket === null ? null : basis.declaredMarket;
  const russianSignals = Array.isArray(basis.russianSignals) ? basis.russianSignals : null;
  if (declaredMarket !== null && declaredMarket !== "ru" && declaredMarket !== "international"
    || !russianSignals
    || new Set(russianSignals).size !== russianSignals.length
    || russianSignals.some((signal) => !["trusted_country", "trusted_phone_country", "locale"].includes(signal))) {
    return false;
  }

  const resolution = resolveMarket({
    declaredMarket,
    trustedCountryCode: russianSignals.includes("trusted_country") ? "ru" : undefined,
    trustedPhoneCountryCode: russianSignals.includes("trusted_phone_country") ? "ru" : undefined,
    locale: russianSignals.includes("locale") ? "ru" : undefined,
  });
  return resolution.market === receipt.market
    && resolution.dataCell.id === receipt.cellCode
    && resolution.routingBasis.reason === basis.reason
    && resolution.routingBasis.declaredMarket === declaredMarket
    && resolution.routingBasis.russianSignals.length === russianSignals.length
    && resolution.routingBasis.russianSignals.every((signal, index) => signal === russianSignals[index]);
}

export function createMarketRoutingReceipt(
  signals: MarketSignals,
  now = Math.floor(Date.now() / 1000),
): string {
  const resolution = resolveMarket(signals);
  const receipt: MarketRoutingReceipt = Object.freeze({
    version: RECEIPT_VERSION,
    market: resolution.market,
    cellCode: resolution.dataCell.id,
    routingBasis: resolution.routingBasis,
    issuedAt: now,
    expiresAt: now + RECEIPT_TTL_SECONDS,
    nonce: randomBytes(16).toString("base64url"),
  });
  const payload = encode(JSON.stringify(receipt));
  return `${payload}.${signature(payload)}`;
}

export function verifyMarketRoutingReceipt(token: string | undefined, now = Math.floor(Date.now() / 1000)):
  MarketRoutingReceipt {
  if (!token) throw new MarketRoutingReceiptError("routing_receipt_invalid");
  const [payload, receivedSignature, extra] = token.split(".");
  if (!payload || !receivedSignature || extra) throw new MarketRoutingReceiptError("routing_receipt_invalid");

  const expectedSignature = signature(payload);
  const received = Buffer.from(receivedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new MarketRoutingReceiptError("routing_receipt_invalid");
  }

  const decoded = decode(payload);
  if (!decoded) throw new MarketRoutingReceiptError("routing_receipt_invalid");
  let receipt: unknown;
  try {
    receipt = JSON.parse(decoded);
  } catch {
    throw new MarketRoutingReceiptError("routing_receipt_invalid");
  }
  if (!validReceipt(receipt)) throw new MarketRoutingReceiptError("routing_receipt_invalid");
  if (receipt.expiresAt < now || receipt.issuedAt > now) {
    throw new MarketRoutingReceiptError("routing_receipt_expired");
  }
  return Object.freeze(receipt);
}

/** Stores no raw PII: only a one-way digest of the signed, opaque receipt. */
export function marketRoutingReceiptDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function marketReceiptSignals(request: Request, declaredMarket: unknown): MarketSignals {
  const language = request.headers.get("accept-language")?.split(",", 1)[0];
  return { declaredMarket, locale: language };
}

export function marketReceiptCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: RECEIPT_TTL_SECONDS,
  };
}
