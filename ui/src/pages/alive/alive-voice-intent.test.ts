// Control UI test covers Alive page voice-triggered settings-reveal intent.
import { describe, expect, it } from "vitest";
import { detectSettingsIntent } from "./alive-voice-intent.ts";

describe("detectSettingsIntent", () => {
  it("matches Portuguese trigger phrases", () => {
    expect(detectSettingsIntent("quero trocar o modelo e a voz")).toBe(true);
    expect(detectSettingsIntent("pode mudar a voz agora?")).toBe(true);
    expect(detectSettingsIntent("abrir configuracoes")).toBe(true);
  });

  it("matches accented Portuguese the same as unaccented", () => {
    expect(detectSettingsIntent("quero alterar a configuração")).toBe(true);
    expect(detectSettingsIntent("quero alterar a configuracao")).toBe(true);
  });

  it("matches English trigger phrases", () => {
    expect(detectSettingsIntent("please change the model")).toBe(true);
    expect(detectSettingsIntent("open settings")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(detectSettingsIntent("TROCAR A VOZ AGORA")).toBe(true);
  });

  it("does not match unrelated speech", () => {
    expect(detectSettingsIntent("qual o clima hoje?")).toBe(false);
    expect(detectSettingsIntent("me conta uma historia")).toBe(false);
    expect(detectSettingsIntent("")).toBe(false);
  });
});
