import { afterEach, describe, expect, it, vi } from "vitest";
import { ChaingraphRequestError, queryBlockHeight, querySpentOutputs } from "../src/queryChainGraph";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("querySpentOutputs", () => {
  it("queries all locking bytecodes together", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { search_output: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const ownerPkhs = Array.from({ length: 12 }, (_, index) => index.toString(16).padStart(40, "0"));
    await querySpentOutputs(ownerPkhs, "https://chaingraph.example.com/v1/graphql");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { variables: { lockingBytecodes: string } };
    expect(body.variables.lockingBytecodes.slice(1, -1).split(",")).toHaveLength(12);
  });

  it("classifies a refused connection as a Chaingraph request error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(querySpentOutputs(["01".repeat(20)], "https://chaingraph.example.com/v1/graphql"))
      .rejects.toBeInstanceOf(ChaingraphRequestError);
  });

  it("rejects a request that never returns a response", async () => {
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_, options: RequestInit) => new Promise((_, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));

    const request = querySpentOutputs(["01".repeat(20)], "https://chaingraph.example.com/v1/graphql");
    const rejection = expect(request).rejects.toThrow("10");
    timeoutController.abort();

    await rejection;
  });

  it("rejects HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(querySpentOutputs(["01".repeat(20)], "https://chaingraph.example.com/v1/graphql"))
      .rejects.toThrow("503");
  });

  it("rejects GraphQL errors returned with a successful HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errors: [{ message: "query execution timed out" }] }),
    }));

    await expect(querySpentOutputs(["01".repeat(20)], "https://chaingraph.example.com/v1/graphql"))
      .rejects.toThrow("query execution timed out");
  });

  it("classifies a non-JSON response as a Chaingraph request error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
    }));

    await expect(querySpentOutputs(["01".repeat(20)], "https://chaingraph.example.com/v1/graphql"))
      .rejects.toBeInstanceOf(ChaingraphRequestError);
  });

});

describe("queryBlockHeight", () => {
  it("returns the tip height as a number", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { block: [{ height: "912345" }] } }),
    }));

    await expect(queryBlockHeight("https://chaingraph.example.com/v1/graphql")).resolves.toBe(912345);
  });

  it("rejects a GraphQL response without block data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { unrelated: [] } }),
    }));

    await expect(queryBlockHeight("https://chaingraph.example.com/v1/graphql"))
      .rejects.toBeInstanceOf(ChaingraphRequestError);
  });
});
