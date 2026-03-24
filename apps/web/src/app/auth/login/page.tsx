import LoginPageClient from "./LoginPageClient";

interface LoginPageProps {
  searchParams: Promise<{
    setup?: string;
    next?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const nextPath =
    typeof resolvedSearchParams.next === "string" &&
    resolvedSearchParams.next.startsWith("/")
      ? resolvedSearchParams.next
      : undefined;

  return (
    <LoginPageClient
      setup={resolvedSearchParams.setup === "1"}
      nextPath={nextPath}
    />
  );
}
