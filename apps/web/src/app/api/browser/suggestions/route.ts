const MAX_REMOTE_SUGGESTIONS = 6;

const toSuggestions = (payload: unknown): string[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  const rawSuggestions = payload[1];
  if (!Array.isArray(rawSuggestions)) {
    return [];
  }

  const seen = new Set<string>();

  return rawSuggestions
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) {
        return false;
      }

      const normalizedValue = value.toLowerCase();
      if (seen.has(normalizedValue)) {
        return false;
      }

      seen.add(normalizedValue);
      return true;
    })
    .slice(0, MAX_REMOTE_SUGGESTIONS);
};

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return Response.json(
      { suggestions: [] },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  try {
    const providerUrl = new URL(
      "https://suggestqueries.google.com/complete/search"
    );
    providerUrl.searchParams.set("client", "firefox");
    providerUrl.searchParams.set("q", query);

    const response = await fetch(providerUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return Response.json(
        { suggestions: [] },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    return Response.json(
      {
        suggestions: toSuggestions(payload),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch {
    return Response.json(
      { suggestions: [] },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
