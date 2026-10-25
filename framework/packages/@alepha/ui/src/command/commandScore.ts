/*
 * A port of cmdk's `command-score` (cmdk 1.1.1, src/command-score.ts), itself
 * derived from https://github.com/superhuman/command-score.
 *
 * MIT License
 *
 * Copyright (c) 2022 Paco Coursey
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// The scores are arranged so that a continuous match of characters results in
// a total score of 1.
//
// The best case: this character is a match, and either this is the start of
// the string or the previous character was also a match.
const SCORE_CONTINUE_MATCH = 1;
// A new match at the start of a word scores better than a new match elsewhere,
// as it is more likely that the user types the starts of fragments. A word
// jump after a space scores slightly higher than one after a slash, a bracket
// or a hyphen.
const SCORE_SPACE_WORD_JUMP = 0.9;
const SCORE_NON_SPACE_WORD_JUMP = 0.8;
// Any other match is not ideal, but it is included for completeness.
const SCORE_CHARACTER_JUMP = 0.17;
// Two transposed letters are penalised significantly: "ouch" is more likely
// than "curtain" when "uc" is typed.
const SCORE_TRANSPOSITION = 0.1;
// The goodness of a match decays slightly with each missing character: "bad"
// is more likely than "bard" when "bd" is typed. This cannot change the order
// the SCORE_* constants give until 100 characters sit between matches.
const PENALTY_SKIPPED = 0.999;
// An exact-case match is slightly better than a case-insensitive one: "HTML"
// is more likely than "haml" when "HM" is typed.
const PENALTY_CASE_MISMATCH = 0.9999;
// A string longer than what was typed is penalised slightly: "html" is more
// likely than "html5" when "html" is typed. The penalty does not grow with the
// number of extra characters, so a sensible secondary order (such as the list's
// own) still decides between many prefix matches.
const PENALTY_NOT_COMPLETE = 0.99;

const IS_GAP_REGEXP = /[\\/_+.#"@[({&]/;
const COUNT_GAPS_REGEXP = /[\\/_+.#"@[({&]/g;
const IS_SPACE_REGEXP = /[\s-]/;
const COUNT_SPACE_REGEXP = /[\s-]/g;

const commandScoreInner = (
  string: string,
  abbreviation: string,
  lowerString: string,
  lowerAbbreviation: string,
  stringIndex: number,
  abbreviationIndex: number,
  memoizedResults: Record<string, number>,
): number => {
  if (abbreviationIndex === abbreviation.length) {
    if (stringIndex === string.length) {
      return SCORE_CONTINUE_MATCH;
    }
    return PENALTY_NOT_COMPLETE;
  }

  const memoizeKey = `${stringIndex},${abbreviationIndex}`;
  const memoized = memoizedResults[memoizeKey];
  if (memoized !== undefined) {
    return memoized;
  }

  const abbreviationChar = lowerAbbreviation.charAt(abbreviationIndex);
  let index = lowerString.indexOf(abbreviationChar, stringIndex);
  let highScore = 0;

  while (index >= 0) {
    let score = commandScoreInner(
      string,
      abbreviation,
      lowerString,
      lowerAbbreviation,
      index + 1,
      abbreviationIndex + 1,
      memoizedResults,
    );
    if (score > highScore) {
      if (index === stringIndex) {
        score *= SCORE_CONTINUE_MATCH;
      } else if (IS_GAP_REGEXP.test(string.charAt(index - 1))) {
        score *= SCORE_NON_SPACE_WORD_JUMP;
        const wordBreaks = string
          .slice(stringIndex, index - 1)
          .match(COUNT_GAPS_REGEXP);
        if (wordBreaks && stringIndex > 0) {
          score *= PENALTY_SKIPPED ** wordBreaks.length;
        }
      } else if (IS_SPACE_REGEXP.test(string.charAt(index - 1))) {
        score *= SCORE_SPACE_WORD_JUMP;
        const spaceBreaks = string
          .slice(stringIndex, index - 1)
          .match(COUNT_SPACE_REGEXP);
        if (spaceBreaks && stringIndex > 0) {
          score *= PENALTY_SKIPPED ** spaceBreaks.length;
        }
      } else {
        score *= SCORE_CHARACTER_JUMP;
        if (stringIndex > 0) {
          score *= PENALTY_SKIPPED ** (index - stringIndex);
        }
      }

      if (string.charAt(index) !== abbreviation.charAt(abbreviationIndex)) {
        score *= PENALTY_CASE_MISMATCH;
      }
    }

    if (
      (score < SCORE_TRANSPOSITION &&
        lowerString.charAt(index - 1) ===
          lowerAbbreviation.charAt(abbreviationIndex + 1)) ||
      (lowerAbbreviation.charAt(abbreviationIndex + 1) ===
        lowerAbbreviation.charAt(abbreviationIndex) &&
        lowerString.charAt(index - 1) !==
          lowerAbbreviation.charAt(abbreviationIndex))
    ) {
      const transposedScore = commandScoreInner(
        string,
        abbreviation,
        lowerString,
        lowerAbbreviation,
        index + 1,
        abbreviationIndex + 2,
        memoizedResults,
      );
      if (transposedScore * SCORE_TRANSPOSITION > score) {
        score = transposedScore * SCORE_TRANSPOSITION;
      }
    }

    if (score > highScore) {
      highScore = score;
    }

    index = lowerString.indexOf(abbreviationChar, index + 1);
  }

  memoizedResults[memoizeKey] = highScore;
  return highScore;
};

/**
 * Every kind of space becomes a plain space, so they match each other.
 */
const formatInput = (value: string): string =>
  value.toLowerCase().replace(COUNT_SPACE_REGEXP, " ");

/**
 * How well `abbreviation` (what was typed) matches `string` (an item's text),
 * from 0 (no match) to 1 (the whole string, exactly).
 *
 * A fuzzy SUBSEQUENCE score, not a substring test: "adl" matches "Audit log".
 * Matches at the start of the string or of a word score higher than matches
 * inside a word, contiguous characters higher than scattered ones, and a short
 * string higher than a long one with the same match, which is why folding a
 * long description into an item's text pushes it down the list.
 *
 * `aliases` are appended to `string`, separated by spaces, before scoring:
 * cmdk's `keywords`.
 */
export const commandScore = (
  string: string,
  abbreviation: string,
  aliases?: readonly string[],
): number => {
  const text =
    aliases && aliases.length > 0 ? `${string} ${aliases.join(" ")}` : string;
  return commandScoreInner(
    text,
    abbreviation,
    formatInput(text),
    formatInput(abbreviation),
    0,
    0,
    {},
  );
};
