import { KNOWN_BIBLE_CODES } from "./bible.constants";

const inferBibleCodeFromName = (fileNameBase: string): string => {
  const upperBase = fileNameBase.toUpperCase();
  const knownCode = KNOWN_BIBLE_CODES.find((code) => upperBase.includes(code));
  if (knownCode) {
    return knownCode;
  }

  const compact = fileNameBase.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (compact.length >= 2 && compact.length <= 8) {
    return compact;
  }

  return 'BIBLE';
};

const formatBibleName = (fileNameBase: string): string => {
  const spaced = fileNameBase
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced.length > 0 ? spaced : 'Bible';
};

export { inferBibleCodeFromName, formatBibleName };
