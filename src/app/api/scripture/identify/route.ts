import { NextResponse } from "next/server";

type IdentifyScripturePayload = {
  transcript: string;
};

type ScriptureSuggestion = {
  reference: string;
  confidence: number;
  source: "parsed" | "ai";
};

/**
 * Try to parse direct scripture references from speech
 * Handles: "Genesis 1", "Gen 1:1", "Matthew 5:1-10", "John 3 16", etc.
 */
function parseDirectReference(text: string): ScriptureSuggestion | null {
  const normalized = text.trim().toLowerCase();

  // Book name mappings (common spoken forms)
  const bookMappings: Record<string, string> = {
    genesis: "Genesis", gen: "Genesis",
    exodus: "Exodus", ex: "Exodus", exod: "Exodus",
    leviticus: "Leviticus", lev: "Leviticus",
    numbers: "Numbers", num: "Numbers",
    deuteronomy: "Deuteronomy", deut: "Deuteronomy",
    joshua: "Joshua", josh: "Joshua",
    judges: "Judges", judg: "Judges",
    ruth: "Ruth",
    "1 samuel": "1 Samuel", "first samuel": "1 Samuel", "1st samuel": "1 Samuel",
    "2 samuel": "2 Samuel", "second samuel": "2 Samuel", "2nd samuel": "2 Samuel",
    "1 kings": "1 Kings", "first kings": "1 Kings", "1st kings": "1 Kings",
    "2 kings": "2 Kings", "second kings": "2 Kings", "2nd kings": "2 Kings",
    "1 chronicles": "1 Chronicles", "first chronicles": "1 Chronicles",
    "2 chronicles": "2 Chronicles", "second chronicles": "2 Chronicles",
    ezra: "Ezra",
    nehemiah: "Nehemiah", neh: "Nehemiah",
    esther: "Esther", est: "Esther",
    job: "Job",
    psalms: "Psalms", psalm: "Psalms", ps: "Psalms", psa: "Psalms",
    proverbs: "Proverbs", prov: "Proverbs", pro: "Proverbs",
    ecclesiastes: "Ecclesiastes", eccl: "Ecclesiastes", ecc: "Ecclesiastes",
    "song of solomon": "Song of Solomon", "song of songs": "Song of Solomon", sos: "Song of Solomon",
    isaiah: "Isaiah", isa: "Isaiah",
    jeremiah: "Jeremiah", jer: "Jeremiah",
    lamentations: "Lamentations", lam: "Lamentations",
    ezekiel: "Ezekiel", ezek: "Ezekiel",
    daniel: "Daniel", dan: "Daniel",
    hosea: "Hosea", hos: "Hosea",
    joel: "Joel",
    amos: "Amos",
    obadiah: "Obadiah", obad: "Obadiah",
    jonah: "Jonah", jon: "Jonah",
    micah: "Micah", mic: "Micah",
    nahum: "Nahum", nah: "Nahum",
    habakkuk: "Habakkuk", hab: "Habakkuk",
    zephaniah: "Zephaniah", zeph: "Zephaniah",
    haggai: "Haggai", hag: "Haggai",
    zechariah: "Zechariah", zech: "Zechariah",
    malachi: "Malachi", mal: "Malachi",
    matthew: "Matthew", matt: "Matthew", mat: "Matthew",
    mark: "Mark", mk: "Mark",
    luke: "Luke", lk: "Luke",
    john: "John", jn: "John",
    acts: "Acts",
    romans: "Romans", rom: "Romans",
    "1 corinthians": "1 Corinthians", "first corinthians": "1 Corinthians",
    "2 corinthians": "2 Corinthians", "second corinthians": "2 Corinthians",
    galatians: "Galatians", gal: "Galatians",
    ephesians: "Ephesians", eph: "Ephesians",
    philippians: "Philippians", phil: "Philippians",
    colossians: "Colossians", col: "Colossians",
    "1 thessalonians": "1 Thessalonians", "first thessalonians": "1 Thessalonians",
    "2 thessalonians": "2 Thessalonians", "second thessalonians": "2 Thessalonians",
    "1 timothy": "1 Timothy", "first timothy": "1 Timothy",
    "2 timothy": "2 Timothy", "second timothy": "2 Timothy",
    titus: "Titus",
    philemon: "Philemon", phm: "Philemon",
    hebrews: "Hebrews", heb: "Hebrews",
    james: "James", jas: "James",
    "1 peter": "1 Peter", "first peter": "1 Peter",
    "2 peter": "2 Peter", "second peter": "2 Peter",
    "1 john": "1 John", "first john": "1 John",
    "2 john": "2 John", "second john": "2 John",
    "3 john": "3 John", "third john": "3 John",
    jude: "Jude",
    revelation: "Revelation", rev: "Revelation", revelations: "Revelation",
  };

  // Pattern for spoken references: [book] [chapter] [verse] or [book] chapter [chapter] verse [verse]
  // Examples: "genesis 1", "john 3 16", "matthew chapter 5 verse 3", "psalm 23:1-6"
  const patterns = [
    // "book chapter:verse-verse" or "book chapter:verse"
    /^([a-z]+(?:\s+[a-z]+)?)\s+(\d+)\s*[:]\s*(\d+)(?:\s*[-–]\s*(\d+))?$/i,
    // "book chapter verse" (no colon, common in speech)
    /^([a-z]+(?:\s+[a-z]+)?)\s+(\d+)\s+(\d+)$/i,
    // "book chapter" only
    /^([a-z]+(?:\s+[a-z]+)?)\s+(\d+)$/i,
    // "book chapter X verse Y" (verbose)
    /^([a-z]+(?:\s+[a-z]+)?)\s+chapter\s+(\d+)(?:\s+verse\s+(\d+)(?:\s*(?:to|through|-|–)\s*(\d+))?)?$/i,
    // Numbered books: "1 samuel 1:1" or "first samuel 1:1"
    /^((?:1|2|3|first|second|third|1st|2nd|3rd)\s+[a-z]+)\s+(\d+)(?:\s*[:]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const [, bookRaw, chapter, verseStart, verseEnd] = match;
      const bookKey = bookRaw.toLowerCase().trim();
      const book = bookMappings[bookKey];

      if (book) {
        let reference = `${book} ${chapter}`;
        if (verseStart) {
          reference += `:${verseStart}`;
          if (verseEnd) {
            reference += `-${verseEnd}`;
          }
        }
        return { reference, confidence: 0.95, source: "parsed" };
      }
    }
  }

  return null;
}

export async function POST(request: Request) {
  const body = (await request.json()) as IdentifyScripturePayload;
  
  if (!body?.transcript?.trim()) {
    return NextResponse.json(
      { suggestion: null, error: "No transcript provided" },
      { status: 400 }
    );
  }

  const transcript = body.transcript.trim();

  // 1. Try fast regex-based parsing first
  const parsed = parseDirectReference(transcript);
  if (parsed) {
    return NextResponse.json({ suggestion: parsed });
  }

  // 2. Fallback to AI for scripture quote identification
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { suggestion: null, error: "AI_GATEWAY_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      "https://ai-gateway.vercel.sh/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: [
                "You are a Bible scripture identifier. Given spoken text, identify if it contains or references a Bible verse.",
                "",
                "TASK: Analyze the text and determine if it's quoting or referencing scripture.",
                "",
                "RESPOND WITH JSON ONLY:",
                '{"reference": "Book Chapter:Verse", "confidence": 0.0-1.0}',
                "",
                "Examples:",
                '- "In the beginning God created" → {"reference": "Genesis 1:1", "confidence": 0.95}',
                '- "For God so loved the world" → {"reference": "John 3:16", "confidence": 0.98}',
                '- "The Lord is my shepherd" → {"reference": "Psalm 23:1", "confidence": 0.97}',
                '- Random non-scripture text → {"reference": null, "confidence": 0}',
                "",
                "Only identify well-known scripture quotes. If uncertain, set confidence < 0.7.",
                "ALWAYS respond with valid JSON only, no other text.",
              ].join("\n"),
            },
            {
              role: "user",
              content: transcript,
            },
          ],
          temperature: 0.1,
          max_tokens: 100,
        }),
      }
    );

    if (!response.ok) {
      console.error("AI Gateway error:", response.status);
      return NextResponse.json({ suggestion: null });
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ suggestion: null });
    }

    // Parse AI response
    try {
      const aiResult = JSON.parse(content.trim());
      if (aiResult.reference && aiResult.confidence >= 0.7) {
        return NextResponse.json({
          suggestion: {
            reference: aiResult.reference,
            confidence: aiResult.confidence,
            source: "ai",
          },
        });
      }
    } catch {
      console.error("Failed to parse AI response:", content);
    }

    return NextResponse.json({ suggestion: null });
  } catch (error) {
    console.error("Scripture identify error:", error);
    return NextResponse.json({ suggestion: null });
  }
}
