/**
 * Wend — dependency-free syntax highlighter for the file viewer.
 *
 * A single-pass tokenizer that handles the constructs that carry 90% of the
 * visual signal — comments, strings, numbers, keywords, types, call sites —
 * across the common languages. Deliberately NOT a full parser: it stays small
 * and fast (linear, no backtracking) so it can run on the JS thread for a
 * file-preview without a WebView or a heavyweight grammar dependency.
 *
 * Output is a flat token list; the renderer maps each type to a themed color.
 */

export type TokenType =
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "type"
  | "function"
  | "plain";

export interface Token {
  type: TokenType;
  value: string;
}

interface LangSpec {
  line?: string[];
  block?: [string, string];
  strings: string[];
  keywords: Set<string>;
  types?: Set<string>;
}

const s = (words: string) => new Set(words.trim().split(/\s+/));

const JS_KEYWORDS = s(`
  abstract as async await break case catch class const continue debugger default
  delete do else enum export extends false finally for from function get if implements
  import in instanceof interface is keyof let new null of package private protected public
  readonly return satisfies set static super switch this throw true try type typeof
  undefined var void while with yield namespace declare
`);
const JS_TYPES = s(`
  string number boolean object symbol bigint any unknown never void Array Promise Record
  Partial Readonly Pick Omit Map Set Date RegExp Error
`);

const PY_KEYWORDS = s(`
  False None True and as assert async await break class continue def del elif else except
  finally for from global if import in is lambda nonlocal not or pass raise return try while
  with yield self match case
`);

const GO_KEYWORDS = s(`
  break case chan const continue default defer else fallthrough for func go goto if import
  interface map package range return select struct switch type var nil true false iota
`);
const GO_TYPES = s(`
  bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune
  string uint uint8 uint16 uint32 uint64 uintptr any
`);

const RUST_KEYWORDS = s(`
  as async await break const continue crate dyn else enum extern false fn for if impl in let
  loop match mod move mut pub ref return self Self static struct super trait true type unsafe
  use where while
`);
const RUST_TYPES = s(`
  bool char f32 f64 i8 i16 i32 i64 i128 isize str u8 u16 u32 u64 u128 usize String Vec Option
  Result Box
`);

const SWIFT_KEYWORDS = s(`
  associatedtype class deinit enum extension fileprivate func import init inout internal let
  open operator private protocol public rethrows static struct subscript typealias var break
  case continue default defer do else fallthrough for guard if in repeat return switch where
  while as catch is nil super self Self throw throws try true false async await actor some any
  weak unowned lazy final override convenience required
`);

const JAVA_KEYWORDS = s(`
  abstract assert boolean break byte case catch char class const continue default do double
  else enum extends final finally float for goto if implements import instanceof int interface
  long native new package private protected public return short static strictfp super switch
  synchronized this throw throws transient try void volatile while true false null var record
  sealed yield
`);

const C_KEYWORDS = s(`
  auto break case char const continue default do double else enum extern float for goto if
  inline int long register restrict return short signed sizeof static struct switch typedef
  union unsigned void volatile while bool true false nullptr class namespace template typename
  public private protected virtual override new delete this using friend operator constexpr
  noexcept static_cast dynamic_cast reinterpret_cast const_cast
`);

const BASH_KEYWORDS = s(`
  if then else elif fi case esac for while until do done in function select time coproc
  return local export readonly declare unset shift source alias echo cd set trap exit
`);

const CSS_KEYWORDS = s(`
  important inherit initial unset auto none flex grid block inline absolute relative fixed
  sticky hidden visible solid dashed dotted bold normal italic center left right
`);

const RUBY_KEYWORDS = s(`
  alias and begin break case class def defined do else elsif end ensure false for if in module
  next nil not or redo rescue retry return self super then true undef unless until when while
  yield require require_relative attr_accessor attr_reader attr_writer puts
`);

const PHP_KEYWORDS = s(`
  abstract and array as break callable case catch class clone const continue declare default
  do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends
  final finally fn for foreach function global goto if implements include include_once instanceof
  insteadof interface isset list match namespace new or print private protected public readonly
  require require_once return static switch throw trait try unset use var while xor yield true
  false null self parent
`);

const SQL_KEYWORDS = s(`
  SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP INDEX VIEW
  JOIN LEFT RIGHT INNER OUTER FULL ON GROUP BY ORDER HAVING LIMIT OFFSET DISTINCT AS AND OR NOT
  NULL IS IN BETWEEN LIKE PRIMARY KEY FOREIGN REFERENCES DEFAULT UNIQUE CONSTRAINT CASCADE
  union all count sum avg min max case when then else end
`);

const SPECS: Record<string, LangSpec> = {
  js: { line: ["//"], block: ["/*", "*/"], strings: ['"', "'", "`"], keywords: JS_KEYWORDS, types: JS_TYPES },
  python: { line: ["#"], strings: ['"', "'"], keywords: PY_KEYWORDS },
  go: { line: ["//"], block: ["/*", "*/"], strings: ['"', "`"], keywords: GO_KEYWORDS, types: GO_TYPES },
  rust: { line: ["//"], block: ["/*", "*/"], strings: ['"'], keywords: RUST_KEYWORDS, types: RUST_TYPES },
  swift: { line: ["//"], block: ["/*", "*/"], strings: ['"'], keywords: SWIFT_KEYWORDS },
  java: { line: ["//"], block: ["/*", "*/"], strings: ['"', "'"], keywords: JAVA_KEYWORDS },
  c: { line: ["//"], block: ["/*", "*/"], strings: ['"', "'"], keywords: C_KEYWORDS },
  bash: { line: ["#"], strings: ['"', "'"], keywords: BASH_KEYWORDS },
  css: { block: ["/*", "*/"], strings: ['"', "'"], keywords: CSS_KEYWORDS },
  json: { strings: ['"'], keywords: s("true false null") },
  yaml: { line: ["#"], strings: ['"', "'"], keywords: s("true false null yes no on off") },
  ruby: { line: ["#"], strings: ['"', "'"], keywords: RUBY_KEYWORDS },
  php: { line: ["//", "#"], block: ["/*", "*/"], strings: ['"', "'"], keywords: PHP_KEYWORDS },
  sql: { line: ["--"], block: ["/*", "*/"], strings: ["'", '"'], keywords: SQL_KEYWORDS },
  xml: { block: ["<!--", "-->"], strings: ['"', "'"], keywords: new Set() },
};

const EXT_TO_LANG: Record<string, string> = {
  js: "js", jsx: "js", mjs: "js", cjs: "js", ts: "js", tsx: "js", mts: "js", cts: "js",
  py: "python", pyi: "python",
  go: "go",
  rs: "rust",
  swift: "swift",
  java: "java", kt: "java", kts: "java", scala: "java", groovy: "java",
  c: "c", h: "c", cpp: "c", cc: "c", cxx: "c", hpp: "c", hh: "c", m: "c", mm: "c", cs: "c",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  css: "css", scss: "css", sass: "css", less: "css",
  json: "json", json5: "json",
  yml: "yaml", yaml: "yaml", toml: "yaml",
  rb: "ruby",
  php: "php",
  sql: "sql",
  xml: "xml", html: "xml", htm: "xml", svg: "xml", vue: "xml",
};

/** Resolve a language spec from a filename. Returns null for unknown/plain. */
export function specForFilename(name: string): LangSpec | null {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  const lang = EXT_TO_LANG[ext];
  return lang ? SPECS[lang] : null;
}

const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdentStart = (c: string) =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
const isIdentPart = (c: string) => isIdentStart(c) || isDigit(c);
const isNumPart = (c: string) =>
  isDigit(c) || c === "." || c === "_" || "xXoObBeEaAbBcCdDfF".includes(c);

/**
 * Tokenize `code` per `spec`. Single forward pass; runs of uninteresting
 * characters collapse into one `plain` token so the renderer node count stays
 * proportional to syntax density, not file length.
 */
export function tokenize(code: string, spec: LangSpec | null): Token[] {
  if (!spec) return [{ type: "plain", value: code }];
  const out: Token[] = [];
  const n = code.length;
  let i = 0;
  let plainStart = 0;
  const flush = (end: number) => {
    if (end > plainStart) out.push({ type: "plain", value: code.slice(plainStart, end) });
  };

  while (i < n) {
    const c = code[i];

    const lineTok = spec.line?.find((p) => code.startsWith(p, i));
    if (lineTok) {
      flush(i);
      let j = code.indexOf("\n", i);
      if (j === -1) j = n;
      out.push({ type: "comment", value: code.slice(i, j) });
      i = j;
      plainStart = i;
      continue;
    }

    if (spec.block && code.startsWith(spec.block[0], i)) {
      flush(i);
      const close = code.indexOf(spec.block[1], i + spec.block[0].length);
      const j = close === -1 ? n : close + spec.block[1].length;
      out.push({ type: "comment", value: code.slice(i, j) });
      i = j;
      plainStart = i;
      continue;
    }

    if (spec.strings.includes(c)) {
      flush(i);
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === c) {
          j += 1;
          break;
        }
        if (code[j] === "\n" && c !== "`") break; // unterminated; stop at line end
        j += 1;
      }
      out.push({ type: "string", value: code.slice(i, Math.min(j, n)) });
      i = Math.min(j, n);
      plainStart = i;
      continue;
    }

    if (isDigit(c) || (c === "." && isDigit(code[i + 1] ?? ""))) {
      flush(i);
      let j = i + 1;
      while (j < n && isNumPart(code[j])) j += 1;
      out.push({ type: "number", value: code.slice(i, j) });
      i = j;
      plainStart = i;
      continue;
    }

    if (isIdentStart(c)) {
      flush(i);
      let j = i + 1;
      while (j < n && isIdentPart(code[j])) j += 1;
      const word = code.slice(i, j);
      let type: TokenType = "plain";
      if (spec.keywords.has(word)) type = "keyword";
      else if (spec.types?.has(word) || /^[A-Z]/.test(word)) type = "type";
      else {
        let k = j;
        while (k < n && (code[k] === " " || code[k] === "\t")) k += 1;
        if (code[k] === "(") type = "function";
      }
      if (type !== "plain") {
        out.push({ type, value: word });
        plainStart = j;
      }
      i = j;
      continue;
    }

    i += 1;
  }
  flush(n);
  return out;
}

/** Above this size we render plain text — the node count would jank the UI. */
export const HIGHLIGHT_MAX_BYTES = 100 * 1024;
