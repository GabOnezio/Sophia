import { describe, expect, it } from "vitest";
import {
  isVoiceAutoFailoverEnabled,
  looksLikeVoiceBillingError,
  resolveVoiceFailoverProviderOrder,
} from "./alive-voice-failover.ts";

describe("looksLikeVoiceBillingError", () => {
  it("matches common billing/credit failure phrasing", () => {
    expect(looksLikeVoiceBillingError("Error: insufficient credits")).toBe(true);
    expect(looksLikeVoiceBillingError("HTTP 402 payment required")).toBe(true);
    expect(looksLikeVoiceBillingError("Your credit balance is too low")).toBe(true);
    expect(looksLikeVoiceBillingError("insufficient_quota")).toBe(true);
  });

  it("does not match unrelated failures", () => {
    expect(looksLikeVoiceBillingError("Gateway not connected")).toBe(false);
    expect(looksLikeVoiceBillingError("network error")).toBe(false);
    expect(looksLikeVoiceBillingError(null)).toBe(false);
    expect(looksLikeVoiceBillingError(undefined)).toBe(false);
    expect(looksLikeVoiceBillingError("")).toBe(false);
  });
});

describe("resolveVoiceFailoverProviderOrder", () => {
  it("reads the star-ordered provider list from agents.defaults.voiceModel", () => {
    const configObject = {
      agents: {
        defaults: {
          voiceModel: {
            primary: "google/gemini-live",
            fallbacks: ["openai/gpt-realtime"],
            ratings: { "google/gemini-live": 9, "openai/gpt-realtime": 5 },
          },
        },
      },
    };
    expect(resolveVoiceFailoverProviderOrder(configObject)).toEqual(["google", "openai"]);
  });

  it("de-dupes multiple model refs from the same provider", () => {
    const configObject = {
      agents: {
        defaults: {
          voiceModel: {
            primary: "openai/model-a",
            fallbacks: ["openai/model-b"],
          },
        },
      },
    };
    expect(resolveVoiceFailoverProviderOrder(configObject)).toEqual(["openai"]);
  });

  it("returns an empty list when nothing is configured", () => {
    expect(resolveVoiceFailoverProviderOrder(null)).toEqual([]);
    expect(resolveVoiceFailoverProviderOrder({})).toEqual([]);
  });
});

describe("isVoiceAutoFailoverEnabled", () => {
  it("defaults to enabled when unset", () => {
    expect(isVoiceAutoFailoverEnabled(null)).toBe(true);
    expect(isVoiceAutoFailoverEnabled({})).toBe(true);
    expect(
      isVoiceAutoFailoverEnabled({ agents: { defaults: { voiceModel: "openai/gpt-realtime" } } }),
    ).toBe(true);
  });

  it("respects an explicit false", () => {
    expect(
      isVoiceAutoFailoverEnabled({
        agents: { defaults: { voiceModel: { primary: "openai/x", autoFailover: false } } },
      }),
    ).toBe(false);
  });

  it("treats an explicit true the same as unset", () => {
    expect(
      isVoiceAutoFailoverEnabled({
        agents: { defaults: { voiceModel: { primary: "openai/x", autoFailover: true } } },
      }),
    ).toBe(true);
  });
});
