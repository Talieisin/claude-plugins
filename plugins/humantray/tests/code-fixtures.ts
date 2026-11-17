// Code blocks and what a copy of each must hold, byte for byte (#51). Shared
// by the plugin tests (`codeBlocksOf`, the pane and the viewer) and the page's
// browser check (tests/page-render.check.mjs), so the page and the mod are
// held to the same text.
//
// Every tab, trailing space and CR is written as an escape (`\t`, `\r`, an
// explicit `' '` at a line's end), never typed: an editor could drop a typed
// one without any test noticing. `holds` names what each case must really
// contain, and a test checks that it does. Expected texts are written out by
// hand; none is derived from the code under test. Nothing here imports, so the
// browser check can load it with `--experimental-strip-types`.

export type CodeCase = {
  name: string
  md: string
  /** Every code block's copy text, in order. */
  blocks: string[]
  /** The indexes of blocks that hold a control character and are offered no copy. */
  unsafe?: number[]
  /** Characters the Markdown must hold, so that the case tests what it says. */
  holds?: string[]
}

const T = '\t'
const SP = ' '

/** One runbook step's command, as the owner would run it. */
const command = (n: number) =>
  [
    'cd ~/work/service && git pull --ff-only',
    `docker build -t registry.example.com/svc:step${n} . 2>&1 | tail -n 3`,
    "cat <<'EOF' > /tmp/check.json",
    '{"name": "svc", "tag": "candidate", "replicas": 2}',
    'EOF',
    `cat <<-EOF > /tmp/step${n}.sh`,
    `${T}echo "step ${n}: $HOME"`,
    `${T}EOF`,
  ].join('\n')
/** The output a step must print, exactly. */
const expected = (n: number) => `{"status":"pushed","step":${n},"digest":"sha256:<DIGEST>"}`
const indent = (text: string) =>
  text
    .split('\n')
    .map(line => `   ${line}`)
    .join('\n')
const step = (n: number) =>
  [
    `${n}. Build and push the image:`,
    '',
    '   ```bash',
    indent(command(n)),
    '   ```',
    '',
    '   Expect, in order:',
    '',
    '   ```json',
    indent(expected(n)),
    '   ```',
    '',
    `   - Note the \`<DIGEST>\`: step ${n + 1} uses it.`,
    '   - Anything else: stop, press **Not done**, and paste what you saw.',
  ].join('\n')

/** A long, Markdown-heavy `do` body: one lettered part of a runbook, six steps. */
export const RUNBOOK = [
  '**Part A: build and deploy the candidate.** Run each step in order; fill `<DIGEST>` and `<SP ID>` from earlier output.',
  '',
  [1, 2, 3, 4, 5, 6].map(step).join('\n\n'),
  '',
  'When all six pass, press **Done** ("A done"). If any step stops you, press **Not done** and paste what you saw.',
].join('\n')

export const CODE_CASES: CodeCase[] = [
  {
    name: 'a heredoc with $VAR, a backslash and a trailing space',
    md: ['Run:', '', '```bash', "cat <<'EOF' > /tmp/x", `name=$VAR \\${SP}`, `  path\\to${SP}`, 'EOF', '```', ''].join('\n'),
    blocks: [["cat <<'EOF' > /tmp/x", `name=$VAR \\${SP}`, `  path\\to${SP}`, 'EOF'].join('\n')],
    holds: [`${SP}\n`],
  },
  {
    name: 'a <<-EOF heredoc whose lines start with tabs',
    md: ['```sh', 'cat <<-EOF', `${T}indented with a tab`, `${T}${T}two tabs`, `${T}EOF`, '```'].join('\n'),
    blocks: [['cat <<-EOF', `${T}indented with a tab`, `${T}${T}two tabs`, `${T}EOF`].join('\n')],
    holds: [T],
  },
  {
    name: 'a fence in a numbered list item, with tab-indented heredoc lines',
    md: ['1. Build:', '', '   ```bash', '   cat <<-EOF > f', `   ${T}line one`, `   ${T}EOF`, '   ```', '2. Next.'].join('\n'),
    blocks: [['cat <<-EOF > f', `${T}line one`, `${T}EOF`].join('\n')],
    holds: [T],
  },
  {
    name: 'a fence in a quote',
    md: ['> ```', '> a <b>', '>   c', '> ```'].join('\n'),
    blocks: ['a <b>\n  c'],
  },
  {
    name: 'a tilde fence holding backticks',
    md: ['~~~', 'x ``` y', '~~~'].join('\n'),
    blocks: ['x ``` y'],
  },
  {
    name: 'a four-backtick fence holding a three-backtick fence',
    md: ['````md', '```js', 'inner', '```', '````'].join('\n'),
    blocks: ['```js\ninner\n```'],
  },
  {
    name: 'an unclosed fence runs to the end',
    md: ['```', 'open', '  to the end'].join('\n'),
    blocks: ['open\n  to the end'],
  },
  {
    name: 'an indented block with blank lines inside, one holding spaces',
    md: ['Para.', '', '    line 1', '', '    line 3', '      ', '    line 5', '', ''].join('\n'),
    blocks: ['line 1\n\nline 3\n  \nline 5'],
    holds: ['      \n'],
  },
  {
    name: 'an expected output holding a placeholder',
    md: ['Expect:', '', '```json', '{"digest":"sha256:<DIGEST>"}', '```'].join('\n'),
    blocks: ['{"digest":"sha256:<DIGEST>"}'],
  },
  {
    name: 'every pattern the display rewrites, inside a fence',
    md: [
      '```html',
      '<script>alert(1)</script> <!-- c --> <?x?> </b>',
      '![x](y) javascript:void(0) vbscript:x data:text/html file:///etc file\\:///etc',
      '&#60; &#x3c; &colon; JavaScript:',
      'cat <<EOF',
      '<SP ID>',
      'EOF',
      '```',
    ].join('\n'),
    blocks: [
      [
        '<script>alert(1)</script> <!-- c --> <?x?> </b>',
        '![x](y) javascript:void(0) vbscript:x data:text/html file:///etc file\\:///etc',
        '&#60; &#x3c; &colon; JavaScript:',
        'cat <<EOF',
        '<SP ID>',
        'EOF',
      ].join('\n'),
    ],
  },
  {
    name: 'CRLF line ends',
    md: ['```', 'a', 'b', '```', ''].join('\r\n'),
    blocks: ['a\nb'],
    holds: ['\r\n'],
  },
  {
    name: 'lone CR line ends',
    md: ['```', 'a', 'b', '```'].join('\r'),
    blocks: ['a\nb'],
    holds: ['\r'],
  },
  {
    name: 'tabs after one to three spaces open an indented block',
    md: ['Para.', '', `  ${T}foo`, ` ${T}bar`, `  ${T}${T}baz`].join('\n'),
    blocks: [`foo\nbar\n${T}baz`],
    holds: [`  ${T}`, ` ${T}`],
  },
  {
    name: 'a tab after a quote mark',
    md: [`>${T}${T}code`].join('\n'),
    blocks: ['  code'],
    holds: [`>${T}`],
  },
  {
    name: 'a tab after a list marker',
    md: [`-${T}foo`, '', `${T}\`\`\``, `${T}${T}x`, `${T}\`\`\``].join('\n'),
    blocks: [`${T}x`],
    holds: [`-${T}`],
  },
  {
    name: 'a fence in a list item with lines indented less than its content (lazy lines)',
    md: ['1. Step:', '   ```', `  two-space line${SP}${SP}`, ' one', '   ```'].join('\n'),
    blocks: [`two-space line${SP}${SP}\none`],
    holds: [`${SP}${SP}\n`],
  },
  {
    name: 'a fence in a list item inside a quote',
    md: ['> - item', '>   ```', '>   q <x>', '>     r', '>   ```'].join('\n'),
    blocks: ['q <x>\n  r'],
  },
  {
    name: 'an empty fence',
    md: ['```', '```', '', 'text'].join('\n'),
    blocks: [''],
  },
  {
    name: 'a fence ending in blank lines keeps them',
    md: ['```', 'a', '', '', '```'].join('\n'),
    blocks: ['a\n\n'],
  },
  {
    name: 'a fence indented four spaces is an indented block holding the backticks',
    md: ['Para.', '', '    ```', '    x', '    ```'].join('\n'),
    blocks: ['```\nx\n```'],
  },
  {
    name: 'blocks holding control characters are offered no copy',
    md: ['```', "printf '\u001b[201~'", '```', '', '```', 'safe', '```', '', '```', 'abc \u202e cba', '```', '', '```', 'del \u007f c1 \u0085', '```'].join('\n'),
    blocks: ["printf '\u001b[201~'", 'safe', 'abc \u202e cba', 'del \u007f c1 \u0085'],
    unsafe: [0, 2, 3],
    holds: ['\u001b', '\u202e', '\u007f', '\u0085'],
  },
  {
    name: 'a runbook part: six steps, each a command and its expected output',
    md: RUNBOOK,
    blocks: [1, 2, 3, 4, 5, 6].flatMap(n => [command(n), expected(n)]),
    holds: [T],
  },
]
