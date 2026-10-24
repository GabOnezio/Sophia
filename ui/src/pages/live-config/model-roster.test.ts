// Control UI test covers Configuração Viva provider-roster logic.
import { describe, expect, it } from "vitest";
import {
  addRosterEntry,
  buildRatingsMergePatchFragment,
  buildRosterKey,
  buildRosterPatch,
  parseRoster,
  removeRosterEntry,
  setRosterStars,
} from "./model-roster.ts";

describe("parseRoster", () => {
  it("returns an empty list for an unset config", () => {
    expect(parseRoster(undefined, undefined)).toEqual([]);
    expect(parseRoster(null, undefined)).toEqual([]);
  });

  it("treats a bare string as a single primary-only entry", () => {
    expect(parseRoster("openai/gpt-5.6", undefined)).toEqual([
      { key: "openai/gpt-5.6", provider: "openai", model: "gpt-5.6", stars: 0 },
    ]);
  });

  it("orders primary first, then fallbacks, de-duped", () => {
    const entries = parseRoster(
      { primary: "openai", fallbacks: ["fal", "openai", "xai"] },
      undefined,
    );
    expect(entries.map((e) => e.key)).toEqual(["openai", "fal", "xai"]);
  });

  it("splits provider/model keys and attaches ratings", () => {
    const entries = parseRoster(
      { primary: "fal/flux-pro", fallbacks: ["xai"] },
      { "fal/flux-pro": 8, xai: 5 },
    );
    expect(entries).toEqual([
      { key: "fal/flux-pro", provider: "fal", model: "flux-pro", stars: 8 },
      { key: "xai", provider: "xai", model: null, stars: 5 },
    ]);
  });

  it("defaults unrated entries to 0 stars", () => {
    const entries = parseRoster({ primary: "openai" }, undefined);
    expect(entries[0]?.stars).toBe(0);
  });
});

describe("buildRosterKey", () => {
  it("joins provider and model with a slash", () => {
    expect(buildRosterKey("fal", "flux-pro")).toBe("fal/flux-pro");
  });

  it("returns just the provider when no model is given", () => {
    expect(buildRosterKey("openai")).toBe("openai");
    expect(buildRosterKey("openai", "")).toBe("openai");
    expect(buildRosterKey("openai", "  ")).toBe("openai");
  });
});

describe("buildRosterPatch", () => {
  it("sorts by stars descending, promoting the top entry to primary", () => {
    const entries = [
      { key: "fal", provider: "fal", model: null, stars: 6 },
      { key: "openai", provider: "openai", model: null, stars: 8 },
      { key: "xai", provider: "xai", model: null, stars: 3 },
    ];
    expect(buildRosterPatch(entries)).toEqual({
      primary: "openai",
      fallbacks: ["fal", "xai"],
      ratings: { fal: 6, openai: 8, xai: 3 },
    });
  });

  it("keeps relative order stable for tied ratings", () => {
    const entries = [
      { key: "a", provider: "a", model: null, stars: 5 },
      { key: "b", provider: "b", model: null, stars: 5 },
    ];
    expect(buildRosterPatch(entries).primary).toBe("a");
    expect(buildRosterPatch(entries).fallbacks).toEqual(["b"]);
  });

  it("omits unrated (0-star) entries from the ratings map", () => {
    const entries = [{ key: "openai", provider: "openai", model: null, stars: 0 }];
    expect(buildRosterPatch(entries).ratings).toBeUndefined();
  });

  it("returns an empty patch for an empty roster", () => {
    expect(buildRosterPatch([])).toEqual({ primary: undefined, fallbacks: [], ratings: undefined });
  });
});

describe("addRosterEntry", () => {
  it("appends a new provider", () => {
    const next = addRosterEntry([], { provider: "openai", stars: 7 });
    expect(next).toEqual([{ key: "openai", provider: "openai", model: null, stars: 7 }]);
  });

  it("updates stars in place when the same provider/model is added again", () => {
    const first = addRosterEntry([], { provider: "openai" });
    const second = addRosterEntry(first, { provider: "openai", stars: 9 });
    expect(second).toEqual([{ key: "openai", provider: "openai", model: null, stars: 9 }]);
  });

  it("treats provider+model as a distinct entry from the bare provider", () => {
    const next = addRosterEntry(
      [{ key: "fal", provider: "fal", model: null, stars: 4 }],
      { provider: "fal", model: "flux-pro", stars: 7 },
    );
    expect(next).toHaveLength(2);
  });
});

describe("removeRosterEntry", () => {
  it("removes only the matching entry", () => {
    const entries = [
      { key: "openai", provider: "openai", model: null, stars: 8 },
      { key: "fal", provider: "fal", model: null, stars: 5 },
    ];
    expect(removeRosterEntry(entries, "fal")).toEqual([entries[0]]);
  });
});

describe("buildRatingsMergePatchFragment", () => {
  it("returns null when nothing changed", () => {
    expect(buildRatingsMergePatchFragment(undefined, undefined)).toBeNull();
    expect(buildRatingsMergePatchFragment({ openai: 8 }, { openai: 8 })).toEqual({ openai: 8 });
  });

  it("nulls out keys that were removed", () => {
    expect(buildRatingsMergePatchFragment({ openai: 8, fal: 5 }, { openai: 8 })).toEqual({
      openai: 8,
      fal: null,
    });
  });

  it("nulls every previous key when the new map is empty", () => {
    expect(buildRatingsMergePatchFragment({ openai: 8 }, undefined)).toEqual({ openai: null });
  });

  it("includes newly added keys", () => {
    expect(buildRatingsMergePatchFragment(undefined, { openai: 9 })).toEqual({ openai: 9 });
  });
});

describe("setRosterStars", () => {
  it("updates the matching entry's stars", () => {
    const entries = [{ key: "openai", provider: "openai", model: null, stars: 3 }];
    expect(setRosterStars(entries, "openai", 9)[0]?.stars).toBe(9);
  });

  it("clamps to the 0-10 range", () => {
    const entries = [{ key: "openai", provider: "openai", model: null, stars: 3 }];
    expect(setRosterStars(entries, "openai", 99)[0]?.stars).toBe(10);
    expect(setRosterStars(entries, "openai", -5)[0]?.stars).toBe(0);
  });
});
