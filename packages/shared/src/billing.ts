export type PresentPlanKey = "free" | "pro" | "power";

export type PresentBillingStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "inactive"
  | "unknown";

/** How far a plan's presentation themes go (the themes feature reads this). */
export type PresentThemeTier = "basic" | "custom" | "advanced";

/**
 * What a plan includes. The same numbers are in each Stripe product's
 * feature list, which is what customers read; these are what the app holds
 * them to. Change one, change the other.
 */
export interface PresentPlanDefinition {
  key: PresentPlanKey;
  label: string;
  isPaid: boolean;
  /** AI projection: speech-to-search listening time a month. */
  monthlySpeechLimitSeconds: number;
  /** "Bible & song AI projection". Without it, AI projection is Bible only. */
  songAiProjection: boolean;
  /** AI lyrics fixes a month, or `null` for unlimited. */
  monthlyLyricsFixes: number | null;
  /** People in one workspace, the admins included. */
  workspaceMembers: number;
  /** Cloud storage. Recorded for when media syncs; nothing counts it yet. */
  cloudStorageBytes: number;
  themes: PresentThemeTier;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const UNLIMITED_SPEECH_QUOTA_SECONDS = 100 * 365 * 24 * 60 * 60;

export const isUnlimitedSpeechQuota = (seconds: number): boolean =>
  seconds >= UNLIMITED_SPEECH_QUOTA_SECONDS;

export const PRESENT_PLAN_DEFINITIONS: Record<
  PresentPlanKey,
  PresentPlanDefinition
> = {
  free: {
    key: "free",
    label: "Free",
    isPaid: false,
    monthlySpeechLimitSeconds: 30 * 60,
    songAiProjection: false,
    monthlyLyricsFixes: 5,
    workspaceMembers: 2,
    cloudStorageBytes: 500 * MB,
    themes: "basic",
  },
  pro: {
    key: "pro",
    label: "Pro",
    isPaid: true,
    monthlySpeechLimitSeconds: 4 * 60 * 60,
    songAiProjection: true,
    monthlyLyricsFixes: 100,
    workspaceMembers: 5,
    cloudStorageBytes: 2 * GB,
    themes: "custom",
  },
  power: {
    key: "power",
    label: "Power",
    isPaid: true,
    monthlySpeechLimitSeconds: 100 * 60 * 60,
    songAiProjection: true,
    monthlyLyricsFixes: null,
    workspaceMembers: 20,
    cloudStorageBytes: 100 * GB,
    themes: "advanced",
  },
};

/** Plans in order, so "the better of two" is a comparison. */
export const PRESENT_PLAN_ORDER: PresentPlanKey[] = ["free", "pro", "power"];

export const betterPlan = (left: PresentPlanKey, right: PresentPlanKey): PresentPlanKey =>
  PRESENT_PLAN_ORDER.indexOf(right) > PRESENT_PLAN_ORDER.indexOf(left) ? right : left;

/**
 * Subscription states that still get what was paid for. `past_due` keeps it
 * while Stripe retries the card; cancelled, unpaid and never-completed
 * subscriptions do not.
 */
const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

/** The plan a subscription actually gives, given the state it is in. */
export const effectivePlanKey = (planKey: PresentPlanKey, status: string | null | undefined): PresentPlanKey =>
  planKey === "free" || ENTITLED_STATUSES.has((status ?? "").toLowerCase()) ? planKey : "free";

const FREE_ALIASES = ["free", "free_plan", "free_plan_yr", "community", "starter"];
const PRO_ALIASES = ["pro", "pro_plan", "pro_plan_yr", "professional"];
const POWER_ALIASES = ["power", "power_plan", "power_plan_yr", "enterprise", "team"];

const normalizePlanToken = (value: string | null | undefined): string => {
  return value?.trim().toLowerCase() ?? "";
};

const tokenMatchesAliases = (token: string, aliases: string[]): boolean => {
  return aliases.some(
    (alias) => token === alias || token.startsWith(`${alias}-`) || token.includes(alias),
  );
};

export const resolvePresentPlanKey = (
  input: string | null | undefined,
): PresentPlanKey => {
  const token = normalizePlanToken(input);
  if (!token) {
    return "free";
  }

  if (tokenMatchesAliases(token, POWER_ALIASES)) {
    return "power";
  }

  if (tokenMatchesAliases(token, PRO_ALIASES)) {
    return "pro";
  }

  if (tokenMatchesAliases(token, FREE_ALIASES)) {
    return "free";
  }

  return "free";
};

export const getPresentPlanDefinition = (
  planKey: PresentPlanKey,
): PresentPlanDefinition => {
  return PRESENT_PLAN_DEFINITIONS[planKey];
};

export const formatSpeechHoursLabel = (seconds: number): string => {
  if (isUnlimitedSpeechQuota(seconds)) {
    return "Unlimited";
  }

  const hours = seconds / 3600;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
};
