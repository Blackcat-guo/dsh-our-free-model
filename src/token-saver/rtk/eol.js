/**
 * Line-ending normalisation for the RTK filters.
 *
 * ## The defect this exists to prevent
 *
 * Every filter splits its input with `input.split('\n')`. On Windows the line
 * ending is `\r\n`, so each split line keeps a trailing `\r`. Two of the
 * long-form patterns then fail to match:
 *
 * - `gitStatus` matches `modified:   path` with `/^\s*(modified|…):\s+(.+)$/`.
 *   In JavaScript, `.` does not match `\r`, and `$` (without the `m` flag)
 *   matches only at the end of the *input* — so a line ending in `\r` never
 *   matches, and every "modified" file is dropped from the summary.
 * - `gitStatus`'s porcelain branch takes `raw.slice(3)` as the path, which keeps
 *   the `\r` in the path.
 *
 * Measured on a real `git status` long-form output with 25 modified files:
 *   LF   → 15 lines out, 25 modified paths listed
 *   CRLF →  3 lines out,  0 modified paths listed
 *
 * The regression test that pins this lives in `scripts/rtk-test.mjs` ("CRLF
 * input keeps every modified path", "CRLF and LF long form produce the same
 * content"); the sample there is the same shape `git` prints.
 *
 * This is not an exotic input. On Windows `cmd /c tree`, `cmd /c dir`, every
 * PowerShell cmdlet, and any output that was captured into a variable and
 * re-emitted all arrive with CRLF. Only a byte-passthrough of an MSYS-built
 * `git` stays LF. So the CRLF path is the *normal* path on this platform.
 *
 * ## Why normalise at the boundary, not inside each filter
 *
 * Twelve filters each split on `'\n'`. Patching them one by one would leave
 * the next one broken, and a filter added later would silently inherit the
 * bug. The filter contract is "a string of lines"; the line separator is a
 * transport detail. So the normalisation happens once, in `applyFilter`, right
 * before a filter runs — every filter, present and future, gets it.
 *
 * ## Why the output is put back the way it came in
 *
 * A filter returns text that goes straight into the request body. Rewriting the
 * whole output to LF would change bytes the model sees for no benefit, and would
 * make the "did the filter preserve the line endings" question unanswerable.
 * Instead the filter runs on LF-normalised input and the result is converted
 * back to the input's dominant line ending. A filter's own `'\n'` separators
 * therefore become `'\r\n'` in a CRLF world — which is what the surrounding
 * text uses, and what the model expects to read.
 *
 * @module src/token-saver/rtk/eol.js
 */

/**
 * Detect the dominant line ending of a text.
 *
 * CRLF wins ties: a text that contains one CRLF and many lone LFs is, in
 * practice, a CRLF file with a stray LF, and treating it as LF would leave the
 * stray `\r` in place.
 *
 * @param {string} text - the text to inspect
 * @returns {'\r\n'|'\n'} the dominant line ending
 */
export function dominantEol(text) {
  if (typeof text !== 'string') return '\n'
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  return crlf > 0 && crlf >= lf ? '\r\n' : '\n'
}

/**
 * Normalise line endings to LF.
 *
 * Only `\r\n` is rewritten. A lone `\r` (classic Mac line ending) is left
 * alone: it is vanishingly rare in tool output, and treating it as a line
 * separator would change the meaning of output that legitimately contains a
 * carriage return.
 *
 * @param {string} text - the text to normalise
 * @returns {string} the same text with CRLF replaced by LF
 */
export function toLf(text) {
  if (typeof text !== 'string') return ''
  return text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text
}

/**
 * Convert LF back to a given line ending.
 *
 * @param {string} text - LF-normalised text
 * @param {string} eol - the line ending to use
 * @returns {string} the text with LF replaced by `eol`
 */
export function fromLf(text, eol) {
  if (eol !== '\r\n') return text
  return text.replace(/\n/g, '\r\n')
}
