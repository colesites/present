import { unzipSync } from "fflate";
import { db, type BibleVerse, type BibleVersion } from "./db";

// Known Bible version codes to extract from filenames
const KNOWN_BIBLE_VERSIONS = [
  // Long/Specific versions first to prevent partial matches (e.g. NRSV matching RSV)
  "NRSVCE",
  "NRSVA",
  "NRSV",
  "NKJV",
  "TNIV",
  "AMPC",
  "HCSB",
  "NIrV",
  "NABRE",
  "RSVCE",

  // Base versions
  "KJV",
  "NIV",
  "ESV",
  "NASB",
  "NLT",
  "RSV",
  "AMP",
  "MSG",
  "CSB",
  "NCV",
  "GNT",
  "CEV",
  "TPT",

  // The Passion Translation & Modern Versions
  "VOICE",
  "TLB",
  "PHILLIPS",
  "MOUNCE",

  // Study & Literal Versions
  "NET",
  "ISV",
  "LEB",
  "WEB",
  "ASV",
  "YLT",
  "DARBY",
  "AKJV",
  "RV",
  "ERV",
  "BBE",

  // Catholic & Apocrypha Versions
  "DRA",
  "JB",
  "NJB",

  // Other Popular Versions
  "GW",
  "JUB",
  "MEV",
  "NOG",
  "TLV",
  "CEB",
  "CJB",
  "EHV",
  "GNV",
  "ICB",
  "NLV",

  // International Versions (common abbreviations)
  "BSB",
  "BRG",
  "EASY",
  "EXB",
];

// OSIS book ID to full name mapping
const OSIS_BOOK_NAMES: Record<string, string> = {
  // Old Testament
  "Gen": "Genesis", "Exod": "Exodus", "Lev": "Leviticus", "Num": "Numbers", "Deut": "Deuteronomy",
  "Josh": "Joshua", "Judg": "Judges", "Ruth": "Ruth", "1Sam": "1 Samuel", "2Sam": "2 Samuel",
  "1Kgs": "1 Kings", "2Kgs": "2 Kings", "1Chr": "1 Chronicles", "2Chr": "2 Chronicles",
  "Ezra": "Ezra", "Neh": "Nehemiah", "Esth": "Esther", "Job": "Job", "Ps": "Psalms",
  "Prov": "Proverbs", "Eccl": "Ecclesiastes", "Song": "Song of Solomon", "Isa": "Isaiah",
  "Jer": "Jeremiah", "Lam": "Lamentations", "Ezek": "Ezekiel", "Dan": "Daniel", "Hos": "Hosea",
  "Joel": "Joel", "Amos": "Amos", "Obad": "Obadiah", "Jonah": "Jonah", "Mic": "Micah",
  "Nah": "Nahum", "Hab": "Habakkuk", "Zeph": "Zephaniah", "Hag": "Haggai", "Zech": "Zechariah",
  "Mal": "Malachi",
  
  // New Testament
  "Matt": "Matthew", "Mark": "Mark", "Luke": "Luke", "John": "John", "Acts": "Acts",
  "Rom": "Romans", "1Cor": "1 Corinthians", "2Cor": "2 Corinthians", "Gal": "Galatians",
  "Eph": "Ephesians", "Phil": "Philippians", "Col": "Colossians", "1Thess": "1 Thessalonians",
  "2Thess": "2 Thessalonians", "1Tim": "1 Timothy", "2Tim": "2 Timothy", "Titus": "Titus",
  "Phlm": "Philemon", "Heb": "Hebrews", "Jas": "James", "1Pet": "1 Peter", "2Pet": "2 Peter",
  "1John": "1 John", "2John": "2 John", "3John": "3 John", "Jude": "Jude", "Rev": "Revelation",
};


export type ImportProgress = {
  phase: "downloading" | "unzipping" | "parsing" | "importing";
  percent: number;
};

export async function importBibleModule(
  url: string,
  onProgress: (progress: ImportProgress) => void
): Promise<void> {
  // 1. Download
  onProgress({ phase: "downloading", percent: 0 });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);

  const contentLength = response.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  let loaded = 0;

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Could not get reader from response");

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total) {
      onProgress({ phase: "downloading", percent: Math.round((loaded / total) * 100) });
    }
  }

  const blob = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    blob.set(chunk, offset);
    offset += chunk.length;
  }

  await processBibleBuffer(blob, onProgress);
}

export async function processBibleBuffer(
  buffer: Uint8Array,
  onProgress: (progress: ImportProgress) => void,
  originalFileName?: string,
): Promise<void> {
  // 2. Unzip (if it's a zip, otherwise assume it's raw JSON/XML)
  let fileContent: string;
  let fileName: string | undefined;

  onProgress({ phase: "unzipping", percent: 0 });

  try {
    const unzipped = unzipSync(buffer);
    fileName = Object.keys(unzipped).find(
      (name) => name.endsWith(".json") || name.endsWith(".xml"),
    );
    if (!fileName)
      throw new Error("No valid Bible file (JSON/XML) found in ZIP");
    fileContent = new TextDecoder().decode(unzipped[fileName]);
    onProgress({ phase: "unzipping", percent: 100 });
  } catch (e) {
    // Not a zip, try to parse as direct file
    fileContent = new TextDecoder().decode(buffer);
    // Simple heuristic to detect JSON vs XML
    fileName =
      originalFileName ||
      (fileContent.trim().startsWith("{") ? "bible.json" : "bible.xml");
    onProgress({ phase: "unzipping", percent: 100 });
  }

  // 3. Parse & Import
  if (fileName.endsWith(".json")) {
    await importFromJson(fileContent, onProgress, fileName);
  } else {
    await importFromXml(fileContent, onProgress, fileName);
  }
}

async function importFromJson(
  content: string,
  onProgress: (progress: ImportProgress) => void,
  defaultName: string
) {
  onProgress({ phase: "parsing", percent: 100 });
  const data = JSON.parse(content);
  
  const fileNameBase = defaultName.split(".")[0];
  const bibleName = data.version?.name || fileNameBase.replace(/[_-]/g, " ");

  // Ensure unique ID if not provided, or if it matches an existing one
  const baseId =
    data.version?.id || bibleName.toLowerCase().replace(/\s+/g, "-");
  const versionId = baseId; 

  const version: BibleVersion = {
    ...data.version,
    name: bibleName,
    id: versionId,
    lastUpdated: Date.now(),
    size: content.length,
  };

  const verses: BibleVerse[] = data.verses.map((v: any) => ({
    pk: `${version.id}|${v.bookId}|${v.chapter}|${v.verse}`,
    version: version.id,
    ...v,
  }));

  const books: any[] = data.books || [];
  await performBatchImport(version, verses, onProgress, books);
}

async function importFromXml(
  content: string,
  onProgress: (progress: ImportProgress) => void,
  defaultName: string,
) {
  onProgress({ phase: "parsing", percent: 0 });
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(content, "text/xml");
  const root = xmlDoc.documentElement;

  // Detect format: OSIS vs Simple
  if (root.tagName.toLowerCase() === "osis") {
    await importFromOsisXml(xmlDoc, onProgress, defaultName);
  } else {
    await importFromSimpleXml(xmlDoc, onProgress, defaultName);
  }
}

async function importFromOsisXml(
  xmlDoc: Document,
  onProgress: (progress: ImportProgress) => void,
  defaultName: string,
) {
  const root = xmlDoc.documentElement;
  const fileNameBase = defaultName.split(".")[0];

  // Extract Bible name from OSIS metadata or filename
  const osisWork = xmlDoc.querySelector("work");
  let bibleName =
    osisWork?.getAttribute("title") ||
    osisWork?.querySelector("title")?.textContent ||
    fileNameBase.replace(/[_-]/g, " ");

  if (!bibleName || bibleName.toLowerCase() === "bible") {
    bibleName = fileNameBase.replace(/[_-]/g, " ");
  }

  const bibleId = bibleName.toLowerCase().replace(/\s+/g, "-");

  // Extract version code
  let bibleCode =
    osisWork?.getAttribute("abbreviation") ||
    osisWork?.getAttribute("identifier");

  if (!bibleCode) {
    const upperFileName = fileNameBase.toUpperCase();
    const foundVersion = KNOWN_BIBLE_VERSIONS.find((v) =>
      upperFileName.includes(v.toUpperCase()),
    );

    if (foundVersion) {
      bibleCode = foundVersion.toUpperCase();
    } else if (fileNameBase.length >= 2 && fileNameBase.length <= 5) {
      bibleCode = fileNameBase.toUpperCase();
    } else {
      bibleCode = bibleName.toUpperCase().substring(0, 3);
    }
  }

  const version: BibleVersion = {
    id: bibleId,
    name: bibleName,
    code: bibleCode.toUpperCase(),
    lastUpdated: Date.now(),
    size: new XMLSerializer().serializeToString(xmlDoc).length,
  };

  const verses: BibleVerse[] = [];
  const books: any[] = [];

  // Try multiple OSIS structures
  // Structure 1: <div type="book" osisID="Gen">
  let bookDivs = Array.from(xmlDoc.querySelectorAll('div[type="book"]'));

  // Structure 2: <div type="x-testament"> containing books or other structures
  if (bookDivs.length === 0) {
    // Try finding any div with an osisID that looks like a book ID
    bookDivs = Array.from(xmlDoc.querySelectorAll("div[osisID]")).filter(
      (div) => {
        const osisID = div.getAttribute("osisID") || "";
        // Check if it's a book ID (e.g., "Gen", "Matt", not "Gen.1" or "OT" or "NT")
        return osisID && !osisID.includes(".") && OSIS_BOOK_NAMES[osisID];
      },
    );
  }

  console.log(`[OSIS Import] Found ${bookDivs.length} books in OSIS file`);

  for (let i = 0; i < bookDivs.length; i++) {
    const bookDiv = bookDivs[i] as Element;
    const osisID = bookDiv.getAttribute("osisID") || "";

    // Extract book abbreviation (e.g., "Gen" from "Gen" or "Gen.1.1")
    const bookAbbr = osisID.split(".")[0];
    const bookName = OSIS_BOOK_NAMES[bookAbbr] || bookAbbr;
    const bookId = bookName.toLowerCase().replace(/\s+/g, "").substring(0, 8);

    let maxChapter = 0;

    // Find all verses in this book - try multiple selectors
    let verseElements = Array.from(bookDiv.querySelectorAll("verse"));

    // Also try <verse> with sID attribute (some OSIS formats use start-end milestones)
    if (verseElements.length === 0) {
      verseElements = Array.from(
        bookDiv.querySelectorAll("verse[sID], verse[osisID]"),
      );
    }

    console.log(
      `[OSIS Import] Book ${bookName} (${bookAbbr}): found ${verseElements.length} verses`,
    );

    for (const verseElement of verseElements) {
      // Try osisID first, then sID (start ID)
      const verseOsisID =
        verseElement.getAttribute("osisID") ||
        verseElement.getAttribute("sID") ||
        "";

      // Parse osisID like "Gen.1.1" -> book: Gen, chapter: 1, verse: 1
      const parts = verseOsisID.split(".");

      if (parts.length >= 3) {
        const chapterNum = parseInt(parts[1], 10);
        const verseNum = parseInt(parts[2], 10);

        // Get text - might be in textContent or in next sibling text nodes (for milestone usage)
        let text = verseElement.textContent || "";

        // If verse is a milestone (empty or sID), get text from following siblings
        if (!text.trim() && verseElement.getAttribute("sID")) {
          // It's a start marker, grab text until we hit end marker (typically eID)
          // Simplified: grab text until next verse tag or block end
          let node = verseElement.nextSibling;
          let collectedText = "";

          while (node) {
            if (node.nodeType === Node.TEXT_NODE) {
              collectedText += node.textContent || "";
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const elem = node as Element;
              // Stop if we hit end milestone or next verse
              if (
                elem.tagName === "verse" &&
                (elem.hasAttribute("osisID") || elem.hasAttribute("sID"))
              )
                break;
              if (elem.getAttribute("eID") === verseElement.getAttribute("sID"))
                break; // Matched end tag

              // Skip note tags if desired, or include content? typically include
              collectedText += elem.textContent || "";
            }
            node = node.nextSibling;
          }
          text = collectedText;
        }

        if (chapterNum > maxChapter) maxChapter = chapterNum;

        // Only add if we have text (or if we want empty verses for some reason)
        if (text.trim()) {
          verses.push({
            pk: `${version.id}|${bookId}|${chapterNum}|${verseNum}`,
            version: version.id,
            bookId,
            bookName,
            chapter: chapterNum,
            verse: verseNum,
            text: text.trim(),
          });
        }
      }
    }

    books.push({
      pk: `${version.id}|${bookId}`,
      version: version.id,
      id: bookId,
      name: bookName,
      abbreviation: bookAbbr,
      chapters: maxChapter,
    });

    onProgress({
      phase: "parsing",
      percent: Math.round(((i + 1) / bookDivs.length) * 100),
    });
  }

  await performBatchImport(version, verses, onProgress, books);
}

async function importFromSimpleXml(
  xmlDoc: Document,
  onProgress: (progress: ImportProgress) => void,
  defaultName: string,
) {
  // Robust name extraction
  const root = xmlDoc.documentElement;
  const fileNameBase = defaultName.split(".")[0];

  let bibleName =
    root.getAttribute("name") ||
    root.getAttribute("title") ||
    root.getAttribute("n");

  // If name is too generic or missing, use filename
  if (!bibleName || bibleName.toLowerCase() === "bible") {
    bibleName = fileNameBase.replace(/[_-]/g, " ");
  }

  const bibleId = bibleName.toLowerCase().replace(/\s+/g, "-");

  // Try to get code from attributes, or filename if it's short (2-5 chars), or first 3 of name
  let bibleCode =
    root.getAttribute("abbreviation") ||
    root.getAttribute("shortName") ||
    root.getAttribute("code");

  if (!bibleCode) {
    // Search filename for known version codes (case-insensitive)
    const upperFileName = fileNameBase.toUpperCase();
    const foundVersion = KNOWN_BIBLE_VERSIONS.find((v) =>
      upperFileName.includes(v.toUpperCase()),
    );

    if (foundVersion) {
      bibleCode = foundVersion.toUpperCase();
    } else if (fileNameBase.length >= 2 && fileNameBase.length <= 5) {
      // Short filename, use as-is
      bibleCode = fileNameBase.toUpperCase();
    } else {
      // Fallback: use first 3-4 chars of the parsed name
      bibleCode = bibleName.toUpperCase().substring(0, 3);
    }
  }

  const version: BibleVersion = {
    id: bibleId,
    name: bibleName,
    code: bibleCode.toUpperCase(),
    lastUpdated: Date.now(),
    size: new XMLSerializer().serializeToString(xmlDoc).length,
  };

  const verses: BibleVerse[] = [];
  const books: any[] = [];

  // Support nested structure (e.g. bible > testament > book)
  // Use getElementsByTagName("*") and filter for case-insensitivity to handle <Book>, <BOOK>, <book>, <BIBLEBOOK>, etc.
  const allElements = Array.from(xmlDoc.getElementsByTagName("*"));
  const bookNodes = allElements.filter((el) =>
    ["book", "b", "biblebook"].includes(el.tagName.toLowerCase()),
  );

  console.log(`[XML Import] Found ${bookNodes.length} books`);

  for (let i = 0; i < bookNodes.length; i++) {
    const bookNode = bookNodes[i];
    // Support name, title, n, or number attribute (some formats use number="1" for Genesis)
    let bookName =
      bookNode.getAttribute("name") ||
      bookNode.getAttribute("title") ||
      bookNode.getAttribute("n") ||
      bookNode.getAttribute("bname") || // Support <BIBLEBOOK bname="...">
      "";

    // If name is actually a number (e.g. <book number="1">), try to look up generic name
    // But for simpler approach, let's assume if it has a number attribute, maybe it has a name attribute too
    // In the screenshot: <book number="1"> inside <testament name="Old">.
    // Wait, the screenshot shows <book number="1"> but doesn't show book name!
    // Ah, wait. The screenshot shows:
    // <testament name="Old">
    //   <book number="1">
    //     <chapter number="1">
    //       <verse number="1">

    // In this case (EnglishRSVBible.xml), the book name is NOT in the book tag?
    // If so, we're in trouble unless we map numbers to names.
    // BUT usually these files rely on position or standard ordering.
    // Let's check if there's any other attribute.
    // If not, we might need to map index 0 -> Genesis, etc.

    // Let's assume standard Protestant ordering if no name found
    if (
      !bookName &&
      (bookNode.getAttribute("number") || bookNode.getAttribute("bnumber"))
    ) {
      // Only if we truly can't find a name.
      // We can use the OSIS_BOOK_NAMES keys in order? Or a standard list.
      const bookNum = parseInt(
        bookNode.getAttribute("number") ||
          bookNode.getAttribute("bnumber") ||
          "0",
        10,
      );
      if (bookNum > 0 && bookNum <= 66) {
        // Map 1-66 to Genesis-Revelation
        const standardBooks = [
          "Genesis",
          "Exodus",
          "Leviticus",
          "Numbers",
          "Deuteronomy",
          "Joshua",
          "Judges",
          "Ruth",
          "1 Samuel",
          "2 Samuel",
          "1 Kings",
          "2 Kings",
          "1 Chronicles",
          "2 Chronicles",
          "Ezra",
          "Nehemiah",
          "Esther",
          "Job",
          "Psalms",
          "Proverbs",
          "Ecclesiastes",
          "Song of Solomon",
          "Isaiah",
          "Jeremiah",
          "Lamentations",
          "Ezekiel",
          "Daniel",
          "Hosea",
          "Joel",
          "Amos",
          "Obadiah",
          "Jonah",
          "Micah",
          "Nahum",
          "Habakkuk",
          "Zephaniah",
          "Haggai",
          "Zechariah",
          "Malachi",
          "Matthew",
          "Mark",
          "Luke",
          "John",
          "Acts",
          "Romans",
          "1 Corinthians",
          "2 Corinthians",
          "Galatians",
          "Ephesians",
          "Philippians",
          "Colossians",
          "1 Thessalonians",
          "2 Thessalonians",
          "1 Timothy",
          "2 Timothy",
          "Titus",
          "Philemon",
          "Hebrews",
          "James",
          "1 Peter",
          "2 Peter",
          "1 John",
          "2 John",
          "3 John",
          "Jude",
          "Revelation",
        ];
        bookName = standardBooks[bookNum - 1];
      }
    }

    const bookAbbr =
      bookNode.getAttribute("abbreviation") ||
      bookNode.getAttribute("shortName") ||
      "";

    // Use name as ID if we found one, otherwise generate one
    const bookId = bookName.toLowerCase().replace(/\s+/g, "").substring(0, 8);

    let maxChapter = 0;

    // Find chapters (child elements only, but check case-insensitively)
    // We can't use querySelectorAll with case-insensitive tags easily in XML, so we filter children
    const chapterNodes = Array.from(bookNode.children).filter((el) =>
      ["chapter", "c"].includes(el.tagName.toLowerCase()),
    );

    console.log(
      `[XML Import] Book ${bookName}: found ${chapterNodes.length} chapters`,
    );

    for (let j = 0; j < chapterNodes.length; j++) {
      const chapterNode = chapterNodes[j];
      const chapterNum = parseInt(
        chapterNode.getAttribute("number") ||
          chapterNode.getAttribute("number") ||
          chapterNode.getAttribute("n") ||
          chapterNode.getAttribute("cnumber") || // Support <CHAPTER cnumber="...">
          "0",
        10,
      );
      if (chapterNum > maxChapter) maxChapter = chapterNum;

      // Find verses
      const verseNodes = Array.from(chapterNode.children).filter((el) =>
        ["verse", "v", "vers"].includes(el.tagName.toLowerCase()),
      );

      for (let k = 0; k < verseNodes.length; k++) {
        const verseNode = verseNodes[k];
        const verseNum = parseInt(
          verseNode.getAttribute("number") ||
            verseNode.getAttribute("number") ||
            verseNode.getAttribute("n") ||
            verseNode.getAttribute("vnumber") || // Support <VERS vnumber="...">
            "0",
          10,
        );
        const text = verseNode.textContent || "";

        if (text) {
          verses.push({
            pk: `${version.id}|${bookId}|${chapterNum}|${verseNum}`,
            version: version.id,
            bookId,
            bookName,
            chapter: chapterNum,
            verse: verseNum,
            text,
          });
        }
      }
    }

    console.log(
      `[XML Import] Book ${bookName} processed: ${maxChapter} chapters`,
    );

    // Only add book if we encountered one (and derived a name)
    if (bookName) {
      books.push({
        pk: `${version.id}|${bookId}`,
        version: version.id,
        id: bookId,
        name: bookName,
        abbreviation: bookAbbr,
        chapters: maxChapter,
      });
    }

    onProgress({
      phase: "parsing",
      percent: Math.round(((i + 1) / bookNodes.length) * 100),
    });
  }

  await performBatchImport(version, verses, onProgress, books);
}

async function performBatchImport(
  version: BibleVersion,
  verses: BibleVerse[],
  onProgress: (progress: ImportProgress) => void,
  books: any[]
) {
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(verses.length / BATCH_SIZE);

  await db.transaction("readwrite", [db.versions, db.verses, db.books], async () => {
    await db.versions.put(version);
    await db.books.where("version").equals(version.id).delete();
    await db.verses.where("version").equals(version.id).delete();

    if (books.length > 0) {
      await db.books.bulkAdd(books);
    }

    for (let i = 0; i < totalBatches; i++) {
      const batch = verses.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
      await db.verses.bulkAdd(batch);
      onProgress({ 
        phase: "importing", 
        percent: Math.round(((i + 1) / totalBatches) * 100) 
      });
    }
  });
}
