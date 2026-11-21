// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Written fresh for this entry from the competition's prose spec: it reads a
// CSV text once, left to right, and returns {columns, rows, errors} exactly
// as csv-reader does. Speed comes from never walking the text one character
// at a time: unquoted fields are cut out with one native scan for the next
// delimiter (comma, LF or CR), quoted fields jump from quote to quote with
// indexOf, and plain field text is moved with slice instead of being rebuilt
// character by character. Anything unusual (stray CRs, doubled quotes, CRs
// or LFs inside quotes, junk after a closing quote, unterminated quotes)
// falls back to a careful path that mirrors the reference's error order.
//
// Semantics (summary of the spec; the reference is the authority):
// - U+FEFF at the very start is dropped. A record ends at LF or CRLF; a
//   line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (error stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled;
//   "" inside it is one quote; CRLF / lone CR inside it is read as LF.
//   Text after the closing quote up to the next comma or line break is
//   appended as it stands (error quote_junk when the field ends, if any
//   characters were appended). A quote that never closes is a literal
//   character and the text after it is re-read as unquoted (error
//   unterminated_quote). A quote inside an unquoted field is literal.
// - Fields stay strings, never trimmed or converted. columns is the first
//   record when header is true, else null ( [] when header is true and
//   there is no record). rows are the records after it, each padded with ""
//   (short_row, with fields: its field count) or cut (long_row, with extra:
//   the cut fields) to the first record's width. Each error is
//   {code, line, row} in the order met; line is the 1-based line its record
//   starts on (counting every LF, CRLF and lone CR inside quotes) and row
//   is its record's index in rows (null for the header).

// Next delimiter of an unquoted field: comma, LF or CR. /g so exec() scans
// forward from lastIndex; lastIndex is set before every exec.
const DELIM = /[,\n\r]/g;
// First line break (LF or CR) at or after a position, for quoted content.
const BREAK_CH = /[\n\r]/g;
// First quote or CR at or after a position, for the clean-record fast path.
const QUOTE_OR_CR = /["\r]/g;

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Errors use these, never the moving `line`.
  let recordLine = 1;
  let recordRow = null;

  function pushErr(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at `pos`, onto `init` (characters
  // already kept, e.g. a quoted value before its junk, or the literal '"'
  // of an unterminated quote). Returns {value, ended, added}; `added`
  // counts only the characters appended by this call.
  function unquoted(init) {
    let value = init;
    let added = 0;
    let p = pos;
    for (;;) {
      DELIM.lastIndex = p;
      const m = DELIM.exec(text);
      if (m === null) {
        if (len > p) {
          const s = text.slice(p, len);
          value = value === '' ? s : value + s;
          added += len - p;
        }
        pos = len;
        return { value, ended: END, added };
      }
      const end = m.index;
      const ch = m[0];
      if (ch === ',') {
        if (end > p) {
          const s = text.slice(p, end);
          value = value === '' ? s : value + s;
          added += end - p;
        }
        pos = end + 1;
        return { value, ended: COMMA, added };
      }
      if (ch === '\n') {
        if (end > p) {
          const s = text.slice(p, end);
          value = value === '' ? s : value + s;
          added += end - p;
        }
        pos = end + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // ch === '\r'
      if (text.charCodeAt(end + 1) === 10) {
        // CRLF: the line break.
        if (end > p) {
          const s = text.slice(p, end);
          value = value === '' ? s : value + s;
          added += end - p;
        }
        pos = end + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // Lone CR: a stray_cr, dropped; the field carries on.
      pushErr('stray_cr');
      if (end > p) {
        const s = text.slice(p, end);
        value = value === '' ? s : value + s;
        added += end - p;
      }
      p = end + 1;
    }
  }

  // Reads a quoted field whose opening quote is at `pos`.
  function quoted() {
    const open = pos;
    const openLine = line;
    let segStart = open + 1;
    let scan = open + 1;
    let parts = null;
    let closedAt = -1;
    for (;;) {
      const qi = text.indexOf('"', scan);
      if (qi === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pushErr('unterminated_quote');
        pos = open + 1;
        line = openLine;
        return unquoted('"');
      }
      if (text.charCodeAt(qi + 1) === 34) {
        // Doubled quote: one literal quote in the value.
        if (parts === null) parts = [];
        parts.push(text.slice(segStart, qi));
        parts.push('"');
        scan = qi + 2;
        segStart = qi + 2;
        continue;
      }
      closedAt = qi;
      break;
    }

    // The quoted content is [open+1, closedAt). Count its line breaks and
    // learn whether it holds a CR (which must be rewritten as LF).
    let hasCR = false;
    BREAK_CH.lastIndex = open + 1;
    const firstBreak = BREAK_CH.exec(text);
    if (firstBreak !== null && firstBreak.index < closedAt) {
      let i = open + 1;
      for (;;) {
        const r = text.indexOf('\r', i);
        const n = text.indexOf('\n', i);
        const ri = r === -1 || r >= closedAt ? Infinity : r;
        const ni = n === -1 || n >= closedAt ? Infinity : n;
        if (ri === Infinity && ni === Infinity) break;
        if (ri < ni) {
          hasCR = true;
          line += 1;
          i = ri + 1 < closedAt && text.charCodeAt(ri + 1) === 10 ? ri + 2 : ri + 1;
        } else {
          line += 1;
          i = ni + 1;
        }
      }
    }

    let value;
    if (parts === null) {
      value = hasCR
        ? text.slice(open + 1, closedAt).replace(/\r\n?/g, '\n')
        : text.slice(open + 1, closedAt);
    } else {
      parts.push(text.slice(segStart, closedAt));
      if (hasCR) {
        for (let i = 0; i < parts.length; i++) {
          const s = parts[i];
          if (s.indexOf('\r') !== -1) parts[i] = s.replace(/\r\n?/g, '\n');
        }
      }
      value = parts.join('');
    }

    pos = closedAt + 1;
    if (pos >= len) return { value, ended: END, added: 0 };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA, added: 0 };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = unquoted(value);
    if (junk.added > 0) pushErr('quote_junk');
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record with no quote and no CR in it (apart from the
    // one CR of a CRLF ending) is plain fields split by commas. A quote
    // would open a quoted field (which may span lines) and a CR would be a
    // stray CR or part of a CRLF, so either sends the record to the slow
    // path below. The scan for the first quote-or-CR is native and short:
    // quotes are dense in these texts.
    let fields;
    const nl = text.indexOf('\n', pos);
    let segEnd = nl === -1 ? len : nl;
    if (nl !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
    QUOTE_OR_CR.lastIndex = pos;
    const sp = QUOTE_OR_CR.exec(text);
    if (segEnd > pos && (sp === null || sp.index >= segEnd)) {
      fields = text.slice(pos, segEnd).split(',');
      pos = nl === -1 ? len : nl + 1;
      if (nl !== -1) line += 1;
    } else {
      fields = null;
    }

    if (fields === null) {
      fields = [];
      let ended;
      let isQuoted;
      do {
        isQuoted = text.charCodeAt(pos) === 34;
        const field = isQuoted ? quoted() : unquoted('');
        fields.push(field.value);
        ended = field.ended;
      } while (ended === COMMA);

      // A line that held only stray CRs is left with no characters: no
      // record (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '' && !isQuoted) continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
