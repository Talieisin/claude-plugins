#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["markdown-it-py>=3"]
# ///
"""prose-lint: a linter for formal British professional prose in Markdown and plain text.

It reports problems and never rewrites the text. Each finding has a severity: 'rule' for
a convention that is absolute, 'warn' for a pattern that is usually, but not always, wrong.

Usage:
  prose_lint.py [options] PATH...   lint files and directories ('-' reads standard input)
  prose_lint.py --list-rules        list the rules in force
  prose_lint.py --hook              run as a Claude Code PostToolUse hook (JSON on stdin)

Options:
  --rules FILE      a project rules file (TOML), merged over the built-in rules; repeatable
  --format FORMAT   text (the default), json or report
  --fail-on LEVEL   exit 1 if any finding is at LEVEL or above: rule (the default), warn or never

Suppressing a finding where the wording is deliberate (in Markdown):
  <!-- prose-lint-disable-next-line rule-id ... -->   the next line (all rules if none named)
  <!-- prose-lint-disable rule-id ... -->             from here until prose-lint-enable
  <!-- prose-lint-enable -->
"""
from __future__ import annotations

import codecs
import json
import re
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

try:
    from markdown_it import MarkdownIt
except ImportError:  # reported by main(), so that the hook still answers in JSON
    MarkdownIt = None

HERE = Path(__file__).resolve().parent
BUILTIN_RULES = HERE / 'rules.toml'
SEVERITY_RANK = {'warn': 1, 'rule': 2}
NO_PARSER = 'markdown-it-py is not installed: run with "uv run --script prose_lint.py", which installs it.'


@dataclass
class Finding:
    line: int
    rule: str
    severity: str
    excerpt: str
    message: str
    # The heading, paragraph or bullet the finding is in, used to scope a hook's findings to an edit.
    span: tuple[int, int] = field(default=(0, 0), compare=False, repr=False)

    def render(self, path: str) -> str:
        where = f'{path}:{self.line}' if self.line else f'{path} (edited text)'
        return f'{where} [{self.rule}, {self.severity}] "{self.excerpt}": {self.message}'

    def public(self) -> dict:
        return {'line': self.line, 'rule': self.rule, 'severity': self.severity,
                'excerpt': self.excerpt, 'message': self.message}


# ---- configuration --------------------------------------------------------------------

def load_rules(extra: list[str] | None = None) -> dict:
    """The built-in rules, with each project rules file merged over them in turn.

    A project file may:
      - disable rules by id:              disable = ["stakeholder", "us-spelling"]
      - enable rules off by default:      enable = ["all-purpose-verb"]
      - add rules:                        [[rule]] id, severity, pattern, message, exclude (optional)
      - change thresholds:                [readability] sentence_max_words = 30
      - allow counts that are defined:    [counts] allow = ['(?i)\\bfour quarters\\b']
      - add or override spellings:        [spelling.words] colour = "color" (for the reverse)
      - set the file extensions linted:   [files] extensions = [".md"]
    """
    cfg = tomllib.loads(BUILTIN_RULES.read_text(encoding='utf-8'))
    cfg.setdefault('disable', [])
    for path in extra or []:
        user = tomllib.loads(Path(path).read_text(encoding='utf-8'))
        on = set(user.get('enable', []))
        cfg['disable'] = [r for r in list(cfg['disable']) + list(user.get('disable', [])) if r not in on]
        cfg['rule'] = list(cfg.get('rule', [])) + list(user.get('rule', []))
        for section in ('readability', 'files', 'hook', 'en_dash_words'):
            cfg.setdefault(section, {}).update(user.get(section, {}))
        if 'counts' in user:
            c = user['counts']
            cfg['counts']['allow'] = list(cfg['counts'].get('allow', [])) + list(c.get('allow', []))
            for k in ('pattern', 'message', 'severity', 'units'):
                if k in c:
                    cfg['counts'][k] = c[k]
        if 'spelling' in user:
            s = user['spelling']
            cfg['spelling'].setdefault('words', {}).update(s.get('words', {}))
            if 'ize_stems' in s:
                cfg['spelling']['ize_stems'] = list(s['ize_stems'])
    for r in cfg.get('rule', []):
        for key in ('id', 'severity', 'pattern', 'message'):
            if key not in r:
                raise ValueError(f'rule {r.get("id", "?")} has no {key}')
        if r['severity'] not in SEVERITY_RANK:
            raise ValueError(f'rule {r["id"]}: severity must be "rule" or "warn"')
    return cfg


def enabled(cfg: dict, rule_id: str) -> bool:
    return rule_id not in cfg.get('disable', [])


# ---- parsing: what is prose -------------------------------------------------------------
#
# Markdown is parsed with markdown-it (CommonMark, with tables). Prose is the text of
# headings, paragraphs and list items outside blockquotes. Code, HTML, tables, images,
# link destinations, blockquotes (quoted source material) and front matter are not prose.
# Plain text (.txt) is parsed the same way, except that indented lines are not code and
# there is no front matter.

@dataclass
class Unit:
    kind: str                      # 'heading', 'para' or 'bullet'
    first: int                     # 1-based first and last source lines
    last: int
    text: str                      # the prose, its source lines joined by single spaces
    starts: list[tuple[int, int]]  # (offset in text, source line) for each source line
    raw: str                       # the Markdown source of the block
    before_list: bool = False      # a list follows directly: the block is a list's lead-in
    last_item: bool = False        # a bullet that is the last item of its list

    def line_at(self, offset: int) -> int:
        line = self.first
        for start, n in self.starts:
            if start > offset:
                break
            line = n
        return line


@dataclass
class Parsed:
    units: list[Unit]
    directives: list[tuple[int, str, set[str]]]  # (line, kind, rule ids) from real comments
    leftover_lines: list[str]                    # source lines for the chat-leftover checks


DIRECTIVE = re.compile(r'<!--\s*prose-lint-(disable-next-line|disable|enable)\b([^>]*?)-->')
ALL = '*'


def front_matter_end(lines: list[str]) -> int:
    """The number of lines a closed YAML front-matter block takes at the top, or 0.

    An opening '---' not followed by a YAML key or comment, or never closed, is a divider."""
    if len(lines) < 3 or lines[0].strip() != '---' or not re.match(r'\s*(?:[A-Za-z_][\w-]*\s*:|#)', lines[1]):
        return 0
    for i in range(1, len(lines)):
        if lines[i].strip() in ('---', '...'):
            return i + 1
    return 0


def parse(text: str, plain: bool = False) -> Parsed:
    if MarkdownIt is None:
        raise RuntimeError(NO_PARSER)
    lines = text.split('\n')
    skip = 0 if plain else front_matter_end(lines)
    src = ['' if i < skip or re.match(r'^\s*:{3,}', l) else l for i, l in enumerate(lines)]
    md = MarkdownIt('commonmark').enable('table')
    if plain:
        md.disable('code')
    tokens = md.parse('\n'.join(src))

    units: list[Unit] = []
    directives: list[tuple[int, str, set[str]]] = []
    leftover = list(src)
    quote = table = 0

    def blank(a: int, b: int) -> None:
        for i in range(a, min(b, len(leftover))):
            leftover[i] = ''

    def note_directives(content: str, line: int) -> None:
        for m in DIRECTIVE.finditer(content):
            directives.append((line + content.count('\n', 0, m.start()), m.group(1), set(m.group(2).split()) or {ALL}))

    for i, tok in enumerate(tokens):
        t = tok.type
        if t == 'blockquote_open':
            quote += 1
        elif t == 'blockquote_close':
            quote -= 1
        elif t == 'table_open':
            table += 1
        elif t == 'table_close':
            table -= 1
        elif t in ('fence', 'code_block'):
            blank(*tok.map)
        elif t == 'html_block':
            note_directives(tok.content, tok.map[0] + 1)
            blank(*tok.map)
        elif t == 'inline':
            # A bullet is the first paragraph of a list item.
            kind = ('heading' if tokens[i - 1].type == 'heading_open' else
                    'bullet' if i >= 2 and tokens[i - 2].type == 'list_item_open' else 'para')
            if quote or table or not tok.map:
                if tok.map:
                    for c in tok.children or []:
                        if c.type == 'html_inline':
                            note_directives(c.content, tok.map[0] + 1)
                continue
            unit = inline_unit(tok, kind, directives)
            unit.before_list = (i + 2 < len(tokens) and tokens[i + 1].type == 'paragraph_close'
                                and tokens[i + 2].type in ('bullet_list_open', 'ordered_list_open'))
            if kind == 'bullet':
                unit.last_item = last_item(tokens, i - 2)
            units.append(unit)
    # Inline code and inline comments are not checked for leftovers either. Both may span
    # lines (within a paragraph), so they are masked on the joined text, keeping line breaks.
    keep_lines = lambda m: '\n' * m.group(0).count('\n')
    joined = '\n'.join(leftover)
    joined = re.sub(r'(`+)(?!`)(?:(?!\n[ \t]*\n).)*?(?<!`)\1(?!`)', keep_lines, joined, flags=re.S)
    joined = re.sub(r'<!--.*?-->', keep_lines, joined, flags=re.S)
    return Parsed(units, directives, joined.split('\n'))


def last_item(tokens: list, start: int) -> bool:
    """Whether the list item opened at tokens[start] is the last of its list."""
    level = tokens[start].level
    for j in range(start + 1, len(tokens)):
        if tokens[j].type == 'list_item_close' and tokens[j].level == level:
            return not (j + 1 < len(tokens) and tokens[j + 1].type == 'list_item_open')
    return True


def inline_unit(tok, kind: str, directives: list) -> Unit:
    line = tok.map[0] + 1
    parts: list[str] = []
    starts = [(0, line)]
    length = 0

    def add(s: str) -> None:
        nonlocal length
        parts.append(s)
        length += len(s)

    autolink = False
    for c in tok.children or []:
        if c.type == 'link_open' and c.markup == 'autolink':
            autolink = True
            add('<…>')      # one word, as for code
        elif c.type == 'link_close':
            autolink = False
        elif autolink:
            continue
        elif c.type == 'text':
            add(re.sub(r'\{[#.][^}]*\}', '', c.content))
        elif c.type == 'code_inline':
            add('`…`')      # one word, so sentence lengths stay honest; no rule matches it
        elif c.type in ('softbreak', 'hardbreak'):
            add(' ')
            line += 1
            starts.append((length, line))
        elif c.type == 'html_inline':
            for m in DIRECTIVE.finditer(c.content):
                directives.append((line, m.group(1), set(m.group(2).split()) or {ALL}))
            line += c.content.count('\n')
    return Unit(kind, tok.map[0] + 1, max(tok.map[1], line), ''.join(parts), starts, tok.content)


def suppressions(directives: list[tuple[int, str, set[str]]], lines: list[str]) -> dict[int, set[str]]:
    """Map each 1-based line number to the rule ids suppressed on it ('*' for all)."""
    at: dict[int, list[tuple[str, set[str]]]] = {}
    for n, kind, ids in directives:
        at.setdefault(n, []).append((kind, ids))
    out: dict[int, set[str]] = {}
    active: set[str] = set()
    pending: set[str] | None = None
    for n, line in enumerate(lines, 1):
        here = set(active)
        if pending is not None and line.strip() and n not in at:
            here |= pending
            pending = None
        for kind, ids in at.get(n, []):
            if kind == 'disable':
                active |= ids
                here |= ids
            elif kind == 'enable':
                active = set()
            else:
                pending = ids
        if here:
            out[n] = here
    return out


# ---- sentences --------------------------------------------------------------------------

ABBREV = re.compile(r'\b(?:e\.g|i\.e|etc|cf|No|Ref|para|paras|approx|vs|Mr|Mrs|Ms|Dr|St)\.$', re.I)
SENTENCE_END = re.compile(r'[.!?]["\'”’)\]]*(?=\s+["\'“‘(\[]?[A-Z0-9])')


def sentence_spans(text: str) -> list[tuple[int, int]]:
    out, start = [], 0
    for m in SENTENCE_END.finditer(text):
        if ABBREV.search(text[:m.start() + 1]):
            continue
        out.append((start, m.end()))
        start = m.end()
    out.append((start, len(text)))
    spans = []
    for a, b in out:
        seg = text[a:b]
        lead = len(seg) - len(seg.lstrip())
        if seg.strip():
            spans.append((a + lead, a + lead + len(seg.strip())))
    return spans


def words(s: str) -> int:
    return len(s.split())


def excerpt(s: str, limit: int = 80) -> str:
    s = ' '.join(s.split())
    return s if len(s) <= limit else s[:limit - 3] + '...'


def around(text: str, a: int, b: int) -> str:
    return excerpt(text[max(0, a - 30): b + 30])


# ---- checks ---------------------------------------------------------------------------

CHATBOT = 'chatbot-artefact'
EDGE_PUNCT = '*_"\'“”‘’()[]{}.,;:!?'


def en_dash_words(cfg: dict, text: str) -> list[tuple[int, int]]:
    """Spans of 'word–word' where neither side is an identifier. Each en dash is found
    first and only its neighbouring words examined, so long unbroken strings stay cheap."""
    ident = re.compile(cfg['en_dash_words']['identifier'])
    out = []
    for i, ch in enumerate(text):
        if ch != '–':
            continue
        a = i
        while a > 0 and not text[a - 1].isspace() and text[a - 1] not in '–—':
            a -= 1
        b = i + 1
        while b < len(text) and not text[b].isspace() and text[b] not in '–—':
            b += 1
        left, right = text[a:i].strip(EDGE_PUNCT), text[i + 1:b].strip(EDGE_PUNCT)
        if not (re.search(r'[^\W\d_]', left) and re.search(r'[^\W\d_]', right)):
            continue
        if ident.match(left) or ident.match(right):
            continue
        out.append((a, b))
    return out


def spelling_patterns(cfg: dict) -> list[tuple[re.Pattern, str]]:
    sp = cfg.get('spelling', {})
    out = []
    stems = sorted(set(sp.get('ize_stems', [])), key=len, reverse=True)
    if stems:
        out.append((re.compile(r'(?i)\b(' + '|'.join(map(re.escape, stems)) +
                               r')iz(e|es|ed|ing|ation|ations|er|ers)\b'), ''))
    for us, uk in sp.get('words', {}).items():
        out.append((re.compile(r'(?i)\b' + re.escape(us) + r'\b'), uk))
    return out


def regex_rules(cfg: dict, chatbot: bool) -> list[dict]:
    return [r for r in cfg.get('rule', []) if (r['id'] == CHATBOT) == chatbot and enabled(cfg, r['id'])]


def check_text(text: str, cfg: dict, plain: bool = False) -> list[Finding]:
    parsed = parse(text, plain)
    found: list[Finding] = []

    # Chat-interface leftovers, on the source lines with tables, images and links kept.
    for n, line in enumerate(parsed.leftover_lines, 1):
        for r in regex_rules(cfg, chatbot=True):
            for m in re.finditer(r['pattern'], line):
                found.append(Finding(n, r['id'], r['severity'], around(line, m.start(), m.end()), r['message'], (n, n)))

    rules = [(r, re.compile(r['pattern']), re.compile(r['exclude']) if r.get('exclude') else None)
             for r in regex_rules(cfg, chatbot=False)]
    counts = cfg['counts']
    allow = [re.compile(a) for a in counts.get('allow', [])]
    unit_words = re.compile(counts['units']) if counts.get('units') else None
    spell = spelling_patterns(cfg) if enabled(cfg, 'us-spelling') else []
    sev_spell = cfg.get('spelling', {}).get('severity', 'warn')
    edw = cfg['en_dash_words']
    rd = cfg['readability']
    jp, pp = re.compile(rd['justification_pattern'], re.I), re.compile(rd['passive_pattern'], re.I)

    for u in parsed.units:
        t, span = u.text, (u.first, u.last)

        def add(offset: int, rule: str, sev: str, ex: str, msg: str) -> None:
            found.append(Finding(u.line_at(offset), rule, sev, ex, msg, span))

        for r, pat, excl in rules:
            spans = [(e.start(), e.end()) for e in excl.finditer(t)] if excl else []
            for m in pat.finditer(t):
                if not any(a <= m.start() < b for a, b in spans):
                    add(m.start(), r['id'], r['severity'], around(t, m.start(), m.end()), r['message'])
        if enabled(cfg, 'en-dash-words'):
            for a, b in en_dash_words(cfg, t):
                add(a, 'en-dash-words', edw['severity'], around(t, a, b), edw['message'])
        for pat, uk in spell:
            for m in pat.finditer(t):
                fix = uk or (m.group(1) + 'is' + m.group(2))
                add(m.start(), 'us-spelling', sev_spell, m.group(0),
                    f"House spelling is British with -ise: write '{fix}', unless the document's owner "
                    "has chosen another convention (American, or Oxford -ize).")
        if u.kind == 'heading':
            continue

        ss = sentence_spans(t)
        # An announced count is a number in a list's lead-in: the last sentence of the block
        # directly above a list, whether it ends in a colon or a full stop.
        if enabled(cfg, 'announced-count') and ss and u.before_list:
            a0, b0 = ss[-1]
            for m in re.finditer(counts['pattern'], t[a0:b0]):
                if any(al.search(t[max(0, a0 + m.start() - 5): a0 + m.end() + 5]) for al in allow):
                    continue
                if unit_words and unit_words.match(m.group(0).split()[-1]):
                    continue
                add(a0 + m.start(), 'announced-count', counts.get('severity', 'warn'), m.group(0), counts['message'])
        if u.kind == 'bullet':
            raw = u.raw.strip()
            first = re.sub(r'^[*_"\'“‘(\[]+', '', raw)
            if (enabled(cfg, 'bullet-lower-case') and not raw.startswith('`') and first[:1].islower()
                    and not re.match(r'[a-z]+\.[a-z]', first)):
                add(0, 'bullet-lower-case', 'rule', excerpt(t, 50), 'Bullet items begin with a capital letter.')
            if enabled(cfg, 'bullet-trailing-punctuation') and re.search(r'[;,]$', raw):
                add(len(t), 'bullet-trailing-punctuation', 'rule', excerpt(t, 50),
                    'Bullet items take no trailing semicolon or comma; only the final item ends with a full stop.')
            tail = re.search(r'([;,]?)\s*\b(and|or)$', raw)
            if enabled(cfg, 'bullet-trailing-conjunction') and tail and not u.last_item:
                punct = f" and the {'semicolon' if tail.group(1) == ';' else 'comma'}" if tail.group(1) else ''
                add(len(t), 'bullet-trailing-conjunction', 'warn', excerpt(t, 50),
                    f"A list item ending in '{tail.group(2)}': drop it{punct} and say in the lead-in how the items "
                    "combine ('all of the following', 'one of the following'), unless the conjunction carries a "
                    "condition the lead-in does not.")
        for a, b in ss:
            s = t[a:b]
            if u.kind == 'para' and enabled(cfg, 'semicolon-chain') and s.count(';') >= 2:
                add(a, 'semicolon-chain', 'warn', excerpt(s),
                    'Three or more items run together with semicolons: set them out as a bulleted list.')
            if enabled(cfg, 'long-sentence') and words(s) > rd['sentence_max_words']:
                add(a, 'long-sentence', 'warn', excerpt(s), f'{words(s)} words: check whether this is one claim or several.')
            if enabled(cfg, 'passive-cluster') and len(pp.findall(s)) >= rd['passives_per_sentence']:
                add(a, 'passive-cluster', 'warn', excerpt(s), 'Several passives in one sentence: name who acts.')
            if enabled(cfg, 'justification-cluster') and len(jp.findall(s)) >= rd['justification_per_sentence']:
                add(a, 'justification-cluster', 'warn', excerpt(s),
                    "Several 'so that' or 'because' clauses: keep only the reasons the reader needs.")
        if u.kind == 'para' and ss:
            def first_hit(pat: re.Pattern) -> tuple[int, str]:
                """The offset and text of the sentence holding the pattern's first match."""
                m = pat.search(t)
                a, b = next(((a, b) for a, b in ss if a <= m.start() < b), ss[0])
                return a, excerpt(t[a:b])
            if enabled(cfg, 'long-paragraph') and len(ss) > rd['paragraph_max_sentences']:
                add(0, 'long-paragraph', 'warn', excerpt(t[ss[0][0]:ss[0][1]]),
                    f'{len(ss)} sentences: check whether the paragraph develops more than one idea.')
            if enabled(cfg, 'passive-cluster') and len(pp.findall(t)) >= rd['passives_per_paragraph']:
                a, ex = first_hit(pp)
                add(a, 'passive-cluster', 'warn', ex,
                    f'{len(pp.findall(t))} passives in this paragraph, the first here: name who acts.')
            if enabled(cfg, 'justification-cluster') and len(jp.findall(t)) >= rd['justification_per_paragraph']:
                a, ex = first_hit(jp)
                add(a, 'justification-cluster', 'warn', ex,
                    f"{len(jp.findall(t))} 'so that' or 'because' clauses in this paragraph, the first here: "
                    "keep only the reasons the reader needs.")

    off = suppressions(parsed.directives, text.split('\n'))
    found = [f for f in found if not (off.get(f.line) and (ALL in off[f.line] or f.rule in off[f.line]))]
    found.sort(key=lambda f: (f.line, f.rule))
    return found


def sentence_stats(text: str, plain: bool = False) -> list[int]:
    """Word counts of the sentences in paragraphs and bullets, for the report's summary."""
    return [words(u.text[a:b]) for u in parse(text, plain).units if u.kind != 'heading'
            for a, b in sentence_spans(u.text)]


# ---- files ------------------------------------------------------------------------------

def collect(targets: list[str], cfg: dict) -> list[Path]:
    exts = tuple(cfg['files']['extensions'])
    files: list[Path] = []
    for t in targets:
        p = Path(t)
        if p.is_dir():
            files += sorted(f for f in p.rglob('*') if f.is_file() and f.suffix in exts)
        elif p.is_file():
            files.append(p)
        else:
            raise FileNotFoundError(t)
    return files


def read(path: Path) -> str:
    return path.read_text(encoding='utf-8', errors='replace')


def is_plain(path: Path | str) -> bool:
    return Path(path).suffix == '.txt'


# ---- hook mode (Claude Code PostToolUse) ------------------------------------------------

def read_hook_input(stream=None) -> dict:
    """Read one JSON object without waiting for EOF, since the pipe can stay open."""
    stream = stream or sys.stdin
    decoder, buffer = json.JSONDecoder(), ''
    utf8 = codecs.getincrementaldecoder('utf-8')(errors='replace')
    raw = getattr(stream, 'buffer', None)
    reader = (getattr(raw, 'read1', None) or raw.read) if raw else stream.read
    while True:
        data = reader(4096)
        if not data:
            buffer += utf8.decode(b'', final=True) if isinstance(data, bytes) else ''
            return json.loads(buffer) if buffer.strip() else {}
        chunk = utf8.decode(data) if isinstance(data, bytes) else data
        buffer = (buffer + chunk).lstrip()
        try:
            obj, _ = decoder.raw_decode(buffer)
            return obj
        except json.JSONDecodeError:
            continue


BLOCK_START = re.compile(r'^\s*$|^\s*(?:[-*+]|\d+[.)])\s|^\s*(?:#|>|```|~~~)')


def patch_lines(response: dict) -> tuple[set[int], list[tuple[int, list[str]]]] | None:
    """What an Edit changed, from the structured patch in the tool's response: the lines it
    added, and each pure deletion as (n, the deleted lines), where lines n-1 and n now meet.
    None if there is no patch."""
    hunks = response.get('structuredPatch') if isinstance(response, dict) else None
    if not isinstance(hunks, list):
        return None
    changed: set[int] = set()
    joins: list[tuple[int, list[str]]] = []
    for h in hunks:
        n = h.get('newStart', 1)
        run: list[str] = []
        for line in [l for l in h.get('lines', []) if not l.startswith('\\')] + [' ']:
            if line.startswith('-'):
                run.append(line[1:])
                continue
            if run and not line.startswith('+'):   # deleted with nothing added in its place
                joins.append((n, run))
            run = []
            if line.startswith('+'):
                changed.add(n)
            n += 1
    return changed, joins


def deletion_lines(lines: list[str], n: int, gone: list[str]) -> set[int]:
    """The surviving lines whose heading, paragraph or bullet a pure deletion at n changed:
    the line after it, if the last deleted line ran on into it; the line before it, if the
    first deleted line continued it. A deleted bullet or paragraph that only sat beside its
    neighbours changes neither."""
    out: set[int] = set()
    at = lambda k: lines[k - 1] if 1 <= k <= len(lines) else ''
    if (gone[-1].strip() and not re.match(r'\s*#{1,6}(\s|$)', gone[-1])
            and at(n).strip() and not BLOCK_START.match(at(n))):   # a heading never runs on
        out.add(n)
    if gone[0].strip() and at(n - 1).strip() and not BLOCK_START.match(gone[0]):
        out.add(n - 1)
    return out


def hook_findings(payload: dict, cfg: dict) -> tuple[str, list[Finding]]:
    """A Write is checked whole; an Edit only in the headings, paragraphs and bullets it changed."""
    tool, ti = payload.get('tool_name', ''), payload.get('tool_input') or {}
    path = ti.get('file_path', '')
    if tool not in ('Write', 'Edit', 'MultiEdit') or not path:
        return path, []
    p = Path(path)
    if p.suffix not in tuple(cfg['files']['extensions']) or not p.exists():
        return path, []
    text, plain = read(p), is_plain(p)
    findings = check_text(text, cfg, plain)
    if tool == 'Write':
        return path, findings
    patch = patch_lines(payload.get('tool_response') or {})
    changed, joins = patch if patch else (None, [])
    loose: list[Finding] = []
    if changed is None:
        news = [ti.get('new_string', '')] if tool == 'Edit' else [e.get('new_string', '') for e in ti.get('edits', [])]
        changed = set()
        for new in (n for n in news if n and n.strip()):
            if text.count(new) == 1:
                pos = text.find(new)
                first = text.count('\n', 0, pos) + 1
                changed |= set(range(first, text.count('\n', 0, pos + len(new) - 1) + 2))
            else:   # changed by another hook, or ambiguous: check the new text on its own
                loose += [Finding(0, f.rule, f.severity, f.excerpt, f.message) for f in check_text(new, cfg, plain)]
    # A deletion changed a unit that now runs across it (a line removed from inside a
    # paragraph, or a blank line removed between two), or one it was the edge of.
    lines = text.split('\n')
    for n, gone in joins:
        changed |= deletion_lines(lines, n, gone)
    kept = [f for f in findings if any(f.span[0] <= n <= f.span[1] for n in changed)
            or any(f.span[0] <= n - 1 and n <= f.span[1] for n, _ in joins)]
    return path, kept + loose


def hook_output(path: str, findings: list[Finding], cfg: dict) -> dict:
    if not findings:
        return {}
    cap = cfg['hook']['max_findings']
    shown = sorted(findings, key=lambda f: -SEVERITY_RANK[f.severity])[:cap]   # stable: rules first, in order
    body = '\n'.join('- ' + f.render(path) for f in shown)
    more = f'\n({len(findings) - cap} further findings not shown.)' if len(findings) > cap else ''
    n_rule = sum(f.severity == 'rule' for f in findings)
    return {
        'systemMessage': f'prose-lint: {len(findings)} finding(s) in {path} ({n_rule} rule, {len(findings) - n_rule} warning)',
        'hookSpecificOutput': {
            'hookEventName': 'PostToolUse',
            'additionalContext': (
                f'prose-lint reviewed the text just written to {path}. Fix the "rule" findings in your own prose. '
                'Judge each "warn" finding in context and fix it unless the wording is right there. Leave direct '
                'quotations, official names, required terms and anything the document\'s house style decides '
                'otherwise as they are, and do not rewrite text outside this edit to clear warnings.\n' + body + more),
        },
    }


# ---- command line -------------------------------------------------------------------------

def parse_args(argv: list[str]) -> dict:
    opts = {'rules': [], 'format': 'text', 'fail_on': 'rule', 'targets': [], 'mode': 'check'}
    it = iter(argv)
    for a in it:
        if a in ('-h', '--help'):
            opts['mode'] = 'help'
        elif a == '--hook':
            opts['mode'] = 'hook'
        elif a == '--list-rules':
            opts['mode'] = 'list'
        elif a == '--rules':
            opts['rules'].append(next(it))
        elif a == '--format':
            opts['format'] = next(it)
        elif a == '--fail-on':
            opts['fail_on'] = next(it)
        elif a.startswith('--'):
            raise SystemExit(f'prose-lint: unknown option {a}\n\n{__doc__}')
        else:
            opts['targets'].append(a)
    if opts['format'] not in ('text', 'json', 'report'):
        raise SystemExit('prose-lint: --format must be text, json or report')
    if opts['fail_on'] not in ('rule', 'warn', 'never'):
        raise SystemExit('prose-lint: --fail-on must be rule, warn or never')
    return opts


BUILTIN_STRUCTURAL = [
    ('en-dash-words', 'warn'), ('announced-count', 'warn'), ('us-spelling', 'warn'),
    ('bullet-lower-case', 'rule'), ('bullet-trailing-punctuation', 'rule'), ('bullet-trailing-conjunction', 'warn'),
    ('semicolon-chain', 'warn'),
    ('long-sentence', 'warn'), ('long-paragraph', 'warn'), ('passive-cluster', 'warn'), ('justification-cluster', 'warn'),
]


def list_rules(cfg: dict) -> None:
    seen: dict[str, str] = {}
    for r in cfg.get('rule', []):
        seen.setdefault(r['id'], r['severity'])
    for rid, sev in BUILTIN_STRUCTURAL:
        seen.setdefault(rid, sev)
    for rid, sev in sorted(seen.items()):
        state = 'disabled' if not enabled(cfg, rid) else sev
        print(f'{rid:30} {state}')


RULE_SUMMARY = {
    'long-sentence': 'Sentences over the length threshold: check whether each is one claim or several.',
    'long-paragraph': 'Paragraphs over the sentence threshold: check whether each develops more than one idea.',
    'passive-cluster': 'Passives clustered in a sentence or paragraph: name who acts.',
    'justification-cluster': "'So that' and 'because' clauses clustered: keep only the reasons the reader needs.",
    'us-spelling': 'Spellings other than the house style: each finding gives the house form.',
    'bullet-trailing-conjunction': "List items ending in 'and' or 'or': say in the lead-in how the items combine.",
}


def report(results: list[tuple[str, list[Finding]]], lengths: list[int]) -> None:
    groups: dict[str, list[tuple[str, Finding]]] = {}
    for p, fs in results:
        for f in fs:
            groups.setdefault(f.rule, []).append((p, f))
    total = sum(len(v) for v in groups.values())
    print(f'# Prose lint report\n\n{total} findings in {len(results)} files.\n')
    if lengths:
        mean = sum(lengths) / len(lengths)
        low = (' That is below the range: look for runs of short sentences to join, and do not split '
               'more long ones only to clear warnings.') if mean < 15 else ''
        print(f'Sentences: {len(lengths)}, averaging {mean:.1f} words (the skill aims for 15 to 20); '
              f'longest {max(lengths)}; {sum(n > 25 for n in lengths)} over 25 words.{low}\n')
    print('| Rule | Severity | Findings | Files |\n|---|---|---|---|')
    ordered = sorted(groups.items(), key=lambda kv: -len(kv[1]))
    for rule, items in ordered:
        print(f'| {rule} | {items[0][1].severity} | {len(items)} | {len({p for p, _ in items})} |')
    for rule, items in ordered:
        # One message for the rule where its findings share one; otherwise each finding's own.
        same = len({f.message for _, f in items}) == 1
        heading = items[0][1].message if same else RULE_SUMMARY.get(rule, 'Each finding says what to check.')
        print(f'\n## {rule} ({len(items)})\n\n{heading}\n')
        step = max(1, len(items) // 8)
        for p, f in items[::step][:8]:
            print(f'- `{p}:{f.line}` {f.excerpt}' + ('' if same else f' ({f.message})'))


def main(argv: list[str]) -> int:
    opts = parse_args(argv)
    if opts['mode'] == 'help' or (opts['mode'] == 'check' and not opts['targets']):
        print(__doc__)
        return 0
    if opts['mode'] == 'hook':
        try:
            cfg = load_rules(opts['rules'])
            payload = read_hook_input()
            out = hook_output(*hook_findings(payload, cfg), cfg) if payload.get('hook_event_name', 'PostToolUse') == 'PostToolUse' else {}
            print(json.dumps(out))
        except Exception as e:  # a hook must never fail the edit
            print(json.dumps({'systemMessage': f'prose-lint failed: {e}'}))
        return 0
    if MarkdownIt is None:
        print(f'prose-lint: {NO_PARSER}', file=sys.stderr)
        return 2
    cfg = load_rules(opts['rules'])
    if opts['mode'] == 'list':
        list_rules(cfg)
        return 0

    sources: list[tuple[str, str, bool]] = []
    if '-' in opts['targets']:
        sources.append(('<stdin>', sys.stdin.read(), False))
    try:
        files = collect([t for t in opts['targets'] if t != '-'], cfg)
    except FileNotFoundError as e:
        print(f'prose-lint: no such file or directory: {e}', file=sys.stderr)
        return 2
    sources += [(str(f), read(f), is_plain(f)) for f in files]
    results = [(name, check_text(text, cfg, plain)) for name, text, plain in sources]

    if opts['format'] == 'text':
        for path, fs in results:
            for f in fs:
                print(f.render(path))
    elif opts['format'] == 'json':
        print(json.dumps([{'path': p, **f.public()} for p, fs in results for f in fs], indent=2, ensure_ascii=False))
    else:
        report(results, [n for _, text, plain in sources for n in sentence_stats(text, plain)])

    if opts['fail_on'] == 'never':
        return 0
    floor = SEVERITY_RANK[opts['fail_on']]
    return 1 if any(SEVERITY_RANK[f.severity] >= floor for _, fs in results for f in fs) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
