/**
 * Compact `grep -rn` output ("file:lineno:content").
 *
 * The raw form repeats the full path on every match, so a symbol found 40 times
 * in one file costs 40 path repetitions. This filter groups by directory, keeps
 * the first 10 matches per file with their line numbers, and says how many were
 * dropped. A model that sees "+30" knows the symbol is dense in that file and
 * can read the file; one shown all 40 lines learns nothing extra and pays for
 * the paths.
 *
 * ## Why the layout is size-aware
 *
 * The obvious layout — one `[file] <full path> (N):` header per file — only
 * pays for itself when a file has several matches. With one match per file the
 * header costs more than the path repetition it saves:
 *
 *   input   60 matches over 60 files, 6513 B
 *   per-file layout   7855 B   ← larger than the input: nothing to save
 *   directory layout  3638 B   ← 44% saved
 *
 * And a search over an absolute directory is exactly the shape that produces
 * one match per file: `rg -n foo C:\src` prints the full path on every line,
 * and each file typically matches once. So the layout has to be chosen from the
 * data, not fixed:
 *
 * - Files are grouped by **directory**, so the shared path prefix is printed
 *   once instead of once per file.
 * - A file with **more than one** match gets a `[file] <basename> (N):` header
 *   and an indented list, with the per-file cap and the `+N` overflow marker —
 *   the density signal that tells a model "read this file, it is dense here".
 * - A file with **exactly one** match gets no header: the line carries its own
 *   `basename:line: content`, which is shorter than a header plus a body.
 *
 * Every match keeps its file, its line number, and its content. The directory
 * label normalises Windows separators to `/`, the same convention the `find`
 * filter already uses.
 *
 * Ported from the Rust `grep_wrapper` (splitn(3, ':') semantics).
 *
 * @module src/token-saver/rtk/filters/grep.js
 */

import { GREP_PER_FILE_MAX } from '../constants.js'
import { parseGrepOutput } from '../hitLine.js'

/**
 * Split a path into its directory part and its basename.
 *
 * The directory part is kept verbatim (the caller normalises its separators);
 * the basename is the last path component.
 *
 * @param {string} path
 * @returns {{dir: string, base: string}}
 */
function splitPath(path) {
  const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (lastSep === -1) return { dir: '', base: path }
  return { dir: path.slice(0, lastSep), base: path.slice(lastSep + 1) }
}

export function grep(input) {
  // Direct callers need the same whole-output safety as autodetection.
  const hits = parseGrepOutput(input)
  if (hits === null) return input

  const byFile = new Map()
  for (const { file, line: lineNumStr, content } of hits) {
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file).push([lineNumStr, content])
  }

  // Rust: files.sort_by_key(|(f, _)| *f) — stable ordering matters so the same
  // search produces the same prompt bytes twice.
  const files = Array.from(byFile.keys()).sort()

  // Group by directory, keeping the per-file order inside each group.
  const byDir = new Map()
  for (const file of files) {
    const { dir, base } = splitPath(file)
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push({ base, matches: byFile.get(file) })
  }

  let out = `${hits.length} matches in ${files.length}F:\n\n`

  for (const dir of Array.from(byDir.keys()).sort()) {
    // A path with no directory part (a bare filename) has no group label.
    if (dir !== '') out += `${dir.replace(/\\/g, '/')}/\n`
    for (const { base, matches } of byDir.get(dir)) {
      if (matches.length === 1) {
        // One match: a header would cost more than the path repetition it
        // saves, so the line carries the file name itself.
        out += `  ${base}:${matches[0][0]}: ${matches[0][1].trim()}\n`
        continue
      }
      out += `  [file] ${base} (${matches.length}):\n`
      const show = matches.slice(0, GREP_PER_FILE_MAX)
      for (const [lineNum, content] of show) {
        // Rust: format!("  {:>4}: {}", line_num, content.trim())
        out += `    ${lineNum.padStart(4)}: ${content.trim()}\n`
      }
      if (matches.length > GREP_PER_FILE_MAX) {
        out += `    +${matches.length - GREP_PER_FILE_MAX}\n`
      }
    }
  }

  return out
}

grep.filterName = 'grep'
