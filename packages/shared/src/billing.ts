export type PresentPlanKey = "free" | "pro" | "power";

export type PresentBillingStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "inactive"
  | "unknown";

export interface PresentPlanDefinition {
  key: PresentPlanKey;
  label: string;
  monthlySpeechLimitSeconds: number;
  isPaid: boolean;
}

export const PRESENT_PLAN_DEFINITIONS: Record<
  PresentPlanKey,
  PresentPlanDefinition
> = {
  free: {
    key: "free",
    label: "Free",
    monthlySpeechLimitSeconds: 60 * 60,
    isPaid: false,
  },
  pro: {
    key: "pro",
    label: "Pro",
    monthlySpeechLimitSeconds: 15 * 60 * 60,
    isPaid: true,
  },
  power: {
    key: "power",
    label: "Power",
    monthlySpeechLimitSeconds: 30 * 60 * 60,
    isPaid: true,
  },
};

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
  const hours = seconds / 3600;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
};
