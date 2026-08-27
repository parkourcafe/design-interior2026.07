import { describe, expect, it } from "vitest";
import { TelegramLeaseBook, TelegramLeaseError } from "./lease";

describe("Telegram worker lease fencing", () => {
  it("rejects stale workers after a lease expires and is reclaimed", () => {
    const book = new TelegramLeaseBook();
    book.claim("job-1", 0, 100, "worker-a");
    const second = book.claim("job-1", 101, 100, "worker-b");
    expect(second.attempt).toBe(2);
    expect(() => book.assertCurrent("job-1", "worker-a", 101)).toThrow(
      TelegramLeaseError,
    );
    expect(book.assertCurrent("job-1", "worker-b", 101).leaseToken).toBe("worker-b");
  });
});
