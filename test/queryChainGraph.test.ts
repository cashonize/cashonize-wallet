import { afterEach, describe, expect, it, vi } from "vitest";
import { ChaingraphRequestError, queryBlockHeight } from "../src/queryChainGraph";

const mockChaingraphUrl = "https://chaingraph.example.com/v1/graphql";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the request errors", () => {
  it("classifies a refused connection as a Chaingraph request error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(queryBlockHeight(mockChaingraphUrl))
      .rejects.toBeInstanceOf(ChaingraphRequestError);
  });

  it("rejects a request that never returns a response", async () => {
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_, options: RequestInit) => new Promise((_, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));

    const request = queryBlockHeight(mockChaingraphUrl);
    const rejection = expect(request).rejects.toThrow("10");
    timeoutController.abort();

    await rejection;
  });

  it("rejects HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(queryBlockHeight(mockChaingraphUrl))
      .rejects.toThrow("503");
  });

  it("rejects GraphQL errors returned with a successful HTTP status", async () => {
    // as returned by the demo.chaingraph.cash instance
    const graphqlErrorResponse = {
      errors: [
        {
          extensions: { code: "unexpected", path: "$" },
          message: "database query error",
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(graphqlErrorResponse),
    }));

    await expect(queryBlockHeight(mockChaingraphUrl))
      .rejects.toThrow("database query error");
  });

  it("classifies a non-JSON response as a Chaingraph request error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
    }));

    await expect(queryBlockHeight(mockChaingraphUrl))
      .rejects.toBeInstanceOf(ChaingraphRequestError);
  });

});

describe("queryBlockHeight", () => {
  it("returns the tip height as a number", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { block: [{ height: "912345" }] } }),
    }));

    await expect(queryBlockHeight(mockChaingraphUrl)).resolves.toBe(912345);
  });

  it("rejects a GraphQL response without block data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { unrelated: [] } }),
    }));

    await expect(queryBlockHeight(mockChaingraphUrl))
      .rejects.toBeInstanceOf(ChaingraphRequestError);
  });
});
