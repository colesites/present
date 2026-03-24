import SignupPageClient from "./SignupPageClient";

interface SignupPageProps {
  searchParams: Promise<{
    setup?: string;
    next?: string;
  }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const resolvedSearchParams = await searchParams;
  const nextPath =
    typeof resolvedSearchParams.next === "string" &&
    resolvedSearchParams.next.startsWith("/")
      ? resolvedSearchParams.next
      : undefined;

  return (
    <SignupPageClient
      setup={resolvedSearchParams.setup === "1"}
      nextPath={nextPath}
    />
  );
}
