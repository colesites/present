// When each slide was begun in each recording: [slide, ms from the start of
// the recording], in the order sung. Drafted with `find-starts.mjs` from the
// times the speech service gave the words, then checked by hand against the
// transcript. Where the first word of a slide was not heard, the time is
// that of the next word less the length of a sung word in that recording
// (marked "~"); those are good to about a second.

export const TRUTH = {
  "amazing-grace": [
    [0, 15400],
    [1, 33000],
    [2, 50600],
    [3, 69600], // ~ "how" not heard
    [4, 85800],
    [5, 103400],
    [6, 121200],
    [7, 139200], // ~ "he" not heard
    [8, 155500],
    [9, 171000],
    [10, 188300],
    [11, 206000],
    [12, 223000],
    [13, 240400],
    [0, 259500], // ~ "amazing" not heard
    [1, 277300], // ~ "i" not heard
  ],
  "blessed-assurance": [
    [0, 10900],
    [1, 21900],
    [2, 32000],
    [3, 42900],
    [4, 54200],
    [5, 64500],
    [6, 75200],
    [7, 86200],
    [8, 97400],
    [9, 108100],
    [10, 118300],
    [11, 129400],
  ],
  "softly-and-tenderly": [
    [0, 26100],
    [1, 37100],
    [2, 46600],
    [3, 59000],
    [4, 69300],
    [5, 80100],
    [6, 90500],
    [7, 102500],
    [8, 113000],
    [9, 123900],
    [10, 133800],
    [11, 146800],
    [12, 158200],
    [13, 167700],
    [14, 177000],
    [15, 191000],
  ],
  // The chorus is kept once in the library and sung after every verse.
  "it-is-well": [
    [0, 15800],
    [1, 29300],
    [2, 43500], // ~ "it is well" not heard
    [3, 59800],
    [4, 73200],
    [2, 87200],
    [5, 103400],
    [6, 117000],
    [2, 132000], // ~ the chorus's first line not heard
    [7, 147800],
    [8, 161400],
    [2, 175600],
    [9, 191900],
    [10, 205800],
    [2, 219900],
    [11, 236500],
    [12, 249700],
    [2, 263900],
  ],
  // Sung slowly, with long held notes: the service heard the fewest words
  // here, and the times are rougher (about two seconds).
  "i-surrender-all": [
    [0, 16000], // ~
    [1, 29000],
    [2, 41900],
    [3, 67900],
    [4, 80600],
    [2, 93300],
    [5, 119000], // ~
    [6, 132000], // ~ "let me" not heard
    [2, 145300],
    [7, 171700],
    [8, 184600],
    [2, 197800],
    [9, 215000], // ~
    [10, 237500], // ~ "o the joy of full" not heard
    [2, 250600],
  ],
  "rock-of-ages": [
    [0, 15000], // ~ "rock" not heard
    [1, 24200],
    [2, 34000],
    [3, 44000],
    [4, 52700],
    [5, 62600],
    [6, 72300],
    [7, 81800],
    [8, 91600],
    [9, 101200],
    [10, 110200],
    [11, 120100],
  ],
  "tis-so-sweet": [
    [0, 12000],
    [1, 20600],
    [2, 29000],
    [3, 37800],
    [4, 46900],
    [5, 55700],
    [6, 64100],
    [7, 72800],
    [8, 81700],
    [9, 90200],
    [10, 99400],
    [11, 107800],
    [12, 116600],
    [13, 125700],
    [14, 133700],
    [15, 142400],
  ],
  // The chorus is kept once in the library and sung after every verse.
  "trust-and-obey": [
    [0, 11400],
    [1, 24600],
    [2, 37600],
    [3, 51900],
    [4, 64400],
    [2, 76900],
    [5, 91400],
    [6, 103800],
    [2, 116200],
    [7, 130200],
    [8, 143100],
    [2, 155700],
    [9, 170200],
    [10, 182400],
    [2, 195300],
  ],
};
