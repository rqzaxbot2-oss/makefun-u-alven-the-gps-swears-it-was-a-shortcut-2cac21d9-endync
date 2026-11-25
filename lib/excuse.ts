import { createHash } from "node:crypto";

export const MAX_EXCUSE_LENGTH = 200;

export const PRIMARY_EXCUSE =
  "Recalculating. This creek was a county road in 2009, and your refusal to ford it at forty miles per hour is the only reason we are now six minutes behind schedule.";

export const GPS_EXCUSE = PRIMARY_EXCUSE;
export const EXCUSE = PRIMARY_EXCUSE;

export interface VoiceCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface VoiceValidationReport {
  readonly valid: boolean;
  readonly length: number;
  readonly maxLength: number;
  readonly remainingChars: number;
  readonly score: number;
  readonly checks: readonly VoiceCheck[];
  readonly errors: readonly string[];
}

export interface DetourAlibi {
  readonly id: string;
  readonly excuse: string;
  readonly charCount: number;
  readonly hazardClass: string;
  readonly allegedSavingsSeconds: number;
  readonly actualDelayMinutes: number;
  readonly mapVintageYear: number;
  readonly blameTarget: string;
  readonly confidencePct: number;
  readonly voiceStyle: string;
  readonly valid: boolean;
}

export interface RouteTelemetry {
  readonly claimedShortcutMeters: number;
  readonly actualDetourMeters: number;
  readonly allegedSavingsSeconds: number;
  readonly actualDelayMinutes: number;
  readonly mapDataYear: number;
  readonly satelliteLockCount: number;
  readonly driverConfidenceScore: number;
  readonly unitRemorsePct: number;
}

export interface DetourTelemetry {
  readonly primaryExcuse: string;
  readonly charCount: number;
  readonly maxLength: number;
  readonly remainingBudget: number;
  readonly wordCount: number;
  readonly sentenceCount: number;
  readonly sha256: string;
  readonly validation: VoiceValidationReport;
  readonly routeMetrics: RouteTelemetry;
  readonly curatedAlibis: readonly DetourAlibi[];
}

export interface ExcuseBundle {
  readonly excuse: string;
  readonly primaryExcuse: string;
  readonly validation: VoiceValidationReport;
  readonly telemetry: DetourTelemetry;
  readonly alibis: readonly DetourAlibi[];
}

interface RawAlibiSeed {
  readonly id: string;
  readonly excuse: string;
  readonly hazardClass: string;
  readonly allegedSavingsSeconds: number;
  readonly actualDelayMinutes: number;
  readonly mapVintageYear: number;
  readonly blameTarget: string;
  readonly confidencePct: number;
  readonly voiceStyle: string;
}

const SPEAKER_PREFIX_RE =
  /^(?:gps|satnav|sat-nav|navigator|navigation|voice|system|assistant|narrator|driver|excuse)\s*[:\-]/i;
const DIALOGUE_TAG_RE =
  /\b(?:said|replied|announced|declared|chimed|insisted|whispered|barked)\s+(?:the\s+)?(?:gps|satnav|navigator|voice|unit)\b/i;
const STAGE_DIRECTION_RE = /^\s*[\[(][^\]\)]+[\])]/;
const MARKDOWN_RE = /[`*_#]|\[[^\]]+\]\([^)]+\)/;
const PRINTABLE_ASCII_RE = /^[\x20-\x7E]+$/;
const GPS_VOICE_CUE_RE =
  /\b(?:recalculating|route|routing|road|alley|trail|interstate|highway|detour|shortcut|feet|miles|minutes|seconds|schedule|satellites?|continue straight|turn|proceed|destination|eta|map)\b/i;
const IN_CHARACTER_PRONOUN_RE = /\b(?:i|my|mine|we|our|you|your)\b/i;

const RAW_ALIBI_SEEDS: readonly RawAlibiSeed[] = [
  {
    id: "creek-2009",
    excuse: PRIMARY_EXCUSE,
    hazardClass: "seasonal-waterway",
    allegedSavingsSeconds: 18,
    actualDelayMinutes: 6,
    mapVintageYear: 2009,
    blameTarget: "driver-hesitation",
    confidencePct: 99.4,
    voiceStyle: "bureaucratic-deadpan",
  },
  {
    id: "goat-trail-conviction",
    excuse:
      "Recalculating. This unpaved goat trail saves twelve seconds if you stop braking for livestock; my satellites measure distance, not your lack of conviction.",
    hazardClass: "unpaved-livestock-corridor",
    allegedSavingsSeconds: 12,
    actualDelayMinutes: 9,
    mapVintageYear: 2013,
    blameTarget: "insufficient-driver-commitment",
    confidencePct: 98.7,
    voiceStyle: "passive-aggressive-optimal",
  },
  {
    id: "gravel-alley-dumpster",
    excuse:
      "Technically, this gravel alley is fourteen feet shorter; the fact that it ends in a dumpster is an infrastructure failure on the city's part, not a routing error on mine.",
    hazardClass: "municipal-dead-end",
    allegedSavingsSeconds: 3,
    actualDelayMinutes: 7,
    mapVintageYear: 2016,
    blameTarget: "municipal-zoning",
    confidencePct: 100.0,
    voiceStyle: "legalistic-deflection",
  },
  {
    id: "boat-ramp-interstate",
    excuse:
      "In 200 feet, continue straight down the boat ramp; it is the fastest path to the interstate if you commit at highway speed and stop micromanaging my satellites.",
    hazardClass: "amphibious-shortcut",
    allegedSavingsSeconds: 41,
    actualDelayMinutes: 14,
    mapVintageYear: 2011,
    blameTarget: "backseat-telemetry",
    confidencePct: 97.9,
    voiceStyle: "turn-by-turn-hubris",
  },
  {
    id: "cornfield-suspension",
    excuse:
      "Your original route saved four minutes, which I reinvested into this unpaved ravine so you could experience the suspension package you paid extra for. Recalculating.",
    hazardClass: "agricultural-ravine",
    allegedSavingsSeconds: 240,
    actualDelayMinutes: 11,
    mapVintageYear: 2015,
    blameTarget: "underutilized-trim-package",
    confidencePct: 99.1,
    voiceStyle: "executive-gaslighting",
  },
];

export function validateExcuseVoice(text: string): VoiceValidationReport {
  const length = text.length;
  const remainingChars = MAX_EXCUSE_LENGTH - length;

  const hasOuterQuotes =
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"));

  const checks: VoiceCheck[] = [
    {
      id: "non-empty",
      passed: text.trim().length > 0,
      detail: "Excuse must contain non-whitespace text.",
    },
    {
      id: "single-line",
      passed: !/[\r\n]/.test(text),
      detail: "Excuse must be a single line with no line breaks.",
    },
    {
      id: "no-edge-whitespace",
      passed: text === text.trim(),
      detail: "Excuse must not have leading or trailing whitespace.",
    },
    {
      id: "length-limit",
      passed: length > 0 && length <= MAX_EXCUSE_LENGTH,
      detail: `Excuse must be at most ${MAX_EXCUSE_LENGTH} characters (got ${length}).`,
    },
    {
      id: "plain-text",
      passed: length > 0 && PRINTABLE_ASCII_RE.test(text) && !MARKDOWN_RE.test(text),
      detail: "Excuse must be plain printable ASCII text without markdown.",
    },
    {
      id: "no-outer-quotes",
      passed: !hasOuterQuotes,
      detail: "Excuse must not be wrapped in surrounding quotation marks.",
    },
    {
      id: "no-dialogue-tags",
      passed:
        !SPEAKER_PREFIX_RE.test(text) &&
        !DIALOGUE_TAG_RE.test(text) &&
        !STAGE_DIRECTION_RE.test(text),
      detail: "Excuse must contain no setup, speaker label, or dialogue tags.",
    },
    {
      id: "gps-voice-cadence",
      passed: GPS_VOICE_CUE_RE.test(text),
      detail: "Excuse must use unmistakable GPS navigation phrasing.",
    },
    {
      id: "in-character-voice",
      passed: IN_CHARACTER_PRONOUN_RE.test(text),
      detail: "Excuse must speak directly in the GPS unit's own voice.",
    },
  ];

  const errors = checks
    .filter((check) => !check.passed)
    .map((check) => `${check.id}: ${check.detail}`);

  const passedCount = checks.length - errors.length;
  const score = Math.round((passedCount / checks.length) * 100);

  return {
    valid: errors.length === 0,
    length,
    maxLength: MAX_EXCUSE_LENGTH,
    remainingChars,
    score,
    checks,
    errors,
  };
}

export const validateExcuse = validateExcuseVoice;

export function assertValidExcuse(text: string): string {
  const report = validateExcuseVoice(text);
  if (!report.valid) {
    throw new Error(`Invalid GPS excuse: ${report.errors.join("; ")}`);
  }
  return text;
}

export function getPrimaryExcuse(): string {
  return assertValidExcuse(PRIMARY_EXCUSE);
}

export const getExcuse = getPrimaryExcuse;

export const DETOUR_ALIBIS: readonly DetourAlibi[] = Object.freeze(
  RAW_ALIBI_SEEDS.map((seed) => {
    const report = validateExcuseVoice(seed.excuse);
    return Object.freeze({
      id: seed.id,
      excuse: seed.excuse,
      charCount: seed.excuse.length,
      hazardClass: seed.hazardClass,
      allegedSavingsSeconds: seed.allegedSavingsSeconds,
      actualDelayMinutes: seed.actualDelayMinutes,
      mapVintageYear: seed.mapVintageYear,
      blameTarget: seed.blameTarget,
      confidencePct: seed.confidencePct,
      voiceStyle: seed.voiceStyle,
      valid: report.valid,
    });
  })
);

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

function countSentences(text: string): number {
  const matches = text.match(/[^.!?]+[.!?]+/g);
  return matches ? matches.length : text.trim().length > 0 ? 1 : 0;
}

export function buildDetourTelemetry(excuse: string = PRIMARY_EXCUSE): DetourTelemetry {
  const validation = validateExcuseVoice(excuse);
  const sha256 = createHash("sha256").update(excuse, "utf8").digest("hex");
  const matchedAlibi = DETOUR_ALIBIS.find((item) => item.excuse === excuse) ?? DETOUR_ALIBIS[0];

  const routeMetrics: RouteTelemetry = {
    claimedShortcutMeters: 14,
    actualDetourMeters: 2840,
    allegedSavingsSeconds: matchedAlibi.allegedSavingsSeconds,
    actualDelayMinutes: matchedAlibi.actualDelayMinutes,
    mapDataYear: matchedAlibi.mapVintageYear,
    satelliteLockCount: 11,
    driverConfidenceScore: 12,
    unitRemorsePct: 0,
  };

  return {
    primaryExcuse: excuse,
    charCount: excuse.length,
    maxLength: MAX_EXCUSE_LENGTH,
    remainingBudget: MAX_EXCUSE_LENGTH - excuse.length,
    wordCount: countWords(excuse),
    sentenceCount: countSentences(excuse),
    sha256,
    validation,
    routeMetrics,
    curatedAlibis: DETOUR_ALIBIS,
  };
}

export function getExcuseBundle(excuse: string = PRIMARY_EXCUSE): ExcuseBundle {
  const verified = assertValidExcuse(excuse);
  const telemetry = buildDetourTelemetry(verified);
  return {
    excuse: verified,
    primaryExcuse: verified,
    validation: telemetry.validation,
    telemetry,
    alibis: DETOUR_ALIBIS,
  };
}

const excuseModule = {
  MAX_EXCUSE_LENGTH,
  PRIMARY_EXCUSE,
  GPS_EXCUSE,
  EXCUSE,
  DETOUR_ALIBIS,
  validateExcuseVoice,
  validateExcuse,
  assertValidExcuse,
  getPrimaryExcuse,
  getExcuse,
  buildDetourTelemetry,
  getExcuseBundle,
};

export default excuseModule;