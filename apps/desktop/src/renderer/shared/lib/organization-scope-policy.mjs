export function resolveVerifiedOrganizationId(input) {
  if (!input.hasVerifiedOrganizationScope) return null;

  const organizations = input.organizations.filter(
    (organization) =>
      organization.type === "organization" &&
      typeof organization.id === "string" &&
      typeof organization.name === "string" &&
      organization.name.trim().length > 0,
  );
  const organizationIds = new Set(
    organizations.map((organization) => organization.id),
  );
  const resolveCandidate = (candidate) =>
    candidate && candidate !== "personal" && organizationIds.has(candidate)
      ? candidate
      : null;

  const desktopOrganizationId = resolveCandidate(input.desktopOrganizationId);
  const workspaceOrganizationId =
    input.workspaceType === "organization"
      ? resolveCandidate(input.workspaceOrganizationId)
      : null;
  const hasInvalidDesktopOrganizationId =
    Boolean(
      input.desktopOrganizationId && input.desktopOrganizationId !== "personal",
    ) && !desktopOrganizationId;
  const hasInvalidWorkspaceOrganizationId =
    input.workspaceType === "organization" &&
    Boolean(input.workspaceOrganizationId) &&
    !workspaceOrganizationId;

  return (
    desktopOrganizationId ??
    workspaceOrganizationId ??
    (hasInvalidDesktopOrganizationId || hasInvalidWorkspaceOrganizationId
      ? organizations[0]?.id ?? null
      : null)
  );
}
