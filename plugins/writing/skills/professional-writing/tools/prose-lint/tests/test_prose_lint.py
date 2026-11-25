"""Tests for prose-lint. Run: uv run --no-project --with pytest --with markdown-it-py pytest tests"""
import importlib.util
import io
import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

TOOL = Path(__file__).resolve().parent.parent / 'prose_lint.py'
spec = importlib.util.spec_from_file_location('prose_lint', TOOL)
pl = importlib.util.module_from_spec(spec)
sys.modules['prose_lint'] = pl
spec.loader.exec_module(pl)

CFG = pl.load_rules()


def sentences(text):
    return [text[a:b] for a, b in pl.sentence_spans(text)]


def ids(text, cfg=CFG):
    return [f.rule for f in pl.check_text(text, cfg)]


# ---- dashes ---------------------------------------------------------------------------

def test_em_dash_is_a_rule():
    fs = pl.check_text('The cake is ready — subject to icing.\n', CFG)
    assert any(f.rule == 'em-dash' and f.severity == 'rule' for f in fs)


def test_spaced_en_dash_flagged_but_ranges_are_not():
    assert 'en-dash-spaced' in ids('The cake is ready – subject to icing.\n')
    assert ids('See pages 6–8 for the period 2026–27 and items R1–R14.\n') == []


def test_en_dash_between_words_warns():
    assert 'en-dash-words' in ids('The buyer–seller interface is defined here.\n')


def test_double_hyphen_dash():
    assert 'double-hyphen-dash' in ids('The cake is ready -- subject to icing.\n')


# ---- mechanics --------------------------------------------------------------------------

@pytest.mark.parametrize('text', ["We don't agree.", "It's ready.", "They're late.", "Let's begin.", "We can’t start.",
                                  "We should've arranged it.", "We would’ve approved it."])
def test_contractions(text):
    assert 'contraction' in ids(text + '\n')


def test_possessive_is_not_a_contraction():
    assert 'contraction' not in ids("The baker's van collects the shop's order.\n")


def test_latin_abbreviations():
    assert ids('Use a list, e.g. this one.\n').count('latin-abbreviation') == 1
    assert 'latin-abbreviation' in ids('One owner, i.e. the baker.\n')


def test_stakeholder():
    assert 'stakeholder' in ids('We will consult the stakeholders.\n')


# ---- diction ----------------------------------------------------------------------------

@pytest.mark.parametrize('text,rule', [
    ('We will utilise the spare room.', 'plain-english'),
    ('We will meet prior to the match.', 'plain-english'),
    ('This is a world-class bakery.', 'marketing'),
    ('It is important to note that prices rise.', 'significance-inflation'),
    ('The distinction matters here.', 'evaluative-filler'),
    ('The framework decides which gardens win.', 'abstraction-as-actor'),
    ('The festival rests on good weather.', 'figurative'),
    ('We will delve into the attic.', 'ai-tell'),
    ('We will leverage the old recipe.', 'ai-tell'),
])
def test_diction_rules(text, rule):
    assert rule in ids(text + '\n')


@pytest.mark.parametrize('text', [
    'The roofing is on the critical path.',
    'The handbook defines the dress code.',
    'The framework is simple.',
    'The order is on hold.',
    'We will carry out the repairs.',
    'We held a meeting in May.',
    'The buyer has leverage over the seller.',
    'The customer settled the invoice.',
    'These matters are for the committee.',
])
def test_diction_exceptions(text):
    assert ids(text + '\n') == [], ids(text + '\n')


def test_announced_count_and_allow_list(tmp_path):
    assert 'announced-count' in ids('Three factors determine the price:\n\n- Cost\n- Time\n')
    extra = tmp_path / 'p.toml'
    wonders = 'The tour covers seven wonders:\n\n- The pyramids\n'
    assert 'announced-count' in ids(wonders)
    extra.write_text("[counts]\nallow = ['(?i)\\bseven wonders\\b']\n")
    cfg = pl.load_rules([str(extra)])
    assert 'announced-count' not in ids(wonders, cfg)
    assert 'announced-count' not in ids('The board met three times. It agreed three points:\n\nThey follow.\n')


@pytest.mark.parametrize('text', ['We received three tenders.', 'Two suppliers hold valid licences.',
                                  'The report has two parts, and three options were considered.'])
def test_counts_outside_a_lead_in_are_facts(text):
    assert 'announced-count' not in ids(text + '\n')


@pytest.mark.parametrize('text', ['The walk is three miles.', 'It took two years.', 'Of the two is better.'])
def test_measurements_are_not_counts(text):
    assert 'announced-count' not in ids(text + '\n')


def test_safety_critical_and_cpu_utilisation_are_terms():
    assert ids('The valve is safety-critical and the CPU utilisation is low.\n') == []


def test_abstraction_rule_ignores_titled_document():
    assert 'abstraction-as-actor' not in ids('The Framework identifies the prizes.\n')
    assert 'abstraction-as-actor' in ids('The framework identifies the winners.\n')


# ---- spelling ---------------------------------------------------------------------------

def test_us_spellings_with_suggestions():
    fs = pl.check_text('We will organize the color scheme and analyze the behavior.\n', CFG)
    sugg = {f.excerpt.lower(): f.message for f in fs if f.rule == 'us-spelling'}
    assert "'organise'" in sugg['organize'] and "'colour'" in sugg['color']
    assert "'analyse'" in sugg['analyze'] and "'behaviour'" in sugg['behavior']


def test_ize_family_and_non_matches():
    assert ids('The organization prioritized it.\n').count('us-spelling') == 2
    assert 'us-spelling' not in ids('The size of the prize may seize attention.\n')
    assert 'us-spelling' not in ids('The program runs nightly.\n')


def test_us_spelling_can_be_disabled(tmp_path):
    extra = tmp_path / 'p.toml'
    extra.write_text('disable = ["us-spelling"]\n')
    assert 'us-spelling' not in ids('The color is fine.\n', pl.load_rules([str(extra)]))


# ---- structure --------------------------------------------------------------------------

def test_bullets():
    got = ids('- the first item;\n- The second item.\n')
    assert got.count('bullet-lower-case') == 1 and got.count('bullet-trailing-punctuation') == 1


def test_semicolon_chain():
    assert 'semicolon-chain' in ids('We paint the hall; we fit the lights; we lay the carpet.\n')


def test_long_sentence_and_threshold(tmp_path):
    long = ' '.join(['word'] * 30) + '.\n'
    assert 'long-sentence' in ids(long)
    extra = tmp_path / 'p.toml'
    extra.write_text('[readability]\nsentence_max_words = 40\n')
    assert 'long-sentence' not in ids(long, pl.load_rules([str(extra)]))


def test_long_paragraph():
    assert 'long-paragraph' in ids(' '.join(f'Sentence number {i} is here.' for i in range(7)) + '\n')


def test_passive_cluster():
    assert 'passive-cluster' in ids('The cake was baked, the table was decorated and the room was cleaned.\n')
    assert 'passive-cluster' not in ids('The cake was baked and the table was decorated.\n')


def test_abbreviation_does_not_split_sentence():
    assert sentences('Ask Dr. Smith. Then begin.') == ['Ask Dr. Smith.', 'Then begin.']


# ---- masking ----------------------------------------------------------------------------

def test_code_front_matter_comments_tables_masked():
    text = ('---\ntitle: A — B\n---\n\n```\nx — y\n```\n\n<!-- a — b -->\n\n| a — b |\n|---|\n\n'
            'Use `don\'t` here.\n')
    assert ids(text) == []


def test_chatbot_leftovers_found_in_tables_and_links():
    assert 'chatbot-artefact' in ids('| Certainly! here |\n|---|\n')
    assert 'chatbot-artefact' in ids('See [the page](https://example.com/?utm_source=x).\n')
    assert 'chatbot-artefact' in ids('The figure is [TBD].\n')


# ---- suppression ------------------------------------------------------------------------

def test_disable_next_line_named_rule():
    text = '<!-- prose-lint-disable-next-line stakeholder -->\nThe stakeholders agree — fully.\n'
    assert ids(text) == ['em-dash']


def test_disable_region_all_rules():
    text = ('<!-- prose-lint-disable -->\nThe stakeholders agree — fully.\n<!-- prose-lint-enable -->\n'
            'We consult the stakeholders.\n')
    fs = pl.check_text(text, CFG)
    assert [f.rule for f in fs] == ['stakeholder'] and fs[0].line == 4


# ---- configuration ----------------------------------------------------------------------

def test_project_rule_added(tmp_path):
    extra = tmp_path / 'p.toml'
    extra.write_text('[[rule]]\nid = "house-term"\nseverity = "rule"\npattern = \'\\bwidget\\b\'\n'
                     'message = "Write component."\n')
    assert 'house-term' in ids('The widget works.\n', pl.load_rules([str(extra)]))


def test_bad_rule_rejected(tmp_path):
    extra = tmp_path / 'p.toml'
    extra.write_text('[[rule]]\nid = "x"\nseverity = "error"\npattern = "x"\nmessage = "m"\n')
    with pytest.raises(ValueError):
        pl.load_rules([str(extra)])


# ---- command line and hook ------------------------------------------------------------

def run(*args, stdin=''):
    return subprocess.run([sys.executable, str(TOOL), *args], input=stdin, capture_output=True, text=True)


def test_cli_exit_codes(tmp_path):
    bad, ok = tmp_path / 'bad.md', tmp_path / 'ok.md'
    bad.write_text('The cake is ready — now.\n')
    ok.write_text('The chef approves the menu.\n')
    assert run(str(bad)).returncode == 1
    assert run(str(ok)).returncode == 0
    assert run('--fail-on', 'never', str(bad)).returncode == 0
    assert run(str(tmp_path / 'missing.md')).returncode == 2


def test_cli_directory_and_json(tmp_path):
    (tmp_path / 'a.md').write_text('We will utilise it.\n')
    (tmp_path / 'b.py').write_text('x = "utilise"\n')
    out = json.loads(run('--format', 'json', '--fail-on', 'never', str(tmp_path)).stdout)
    assert [Path(o['path']).name for o in out] == ['a.md'] and out[0]['rule'] == 'plain-english'


def test_cli_stdin():
    r = run('-', stdin='We consult the stakeholders.\n')
    assert '<stdin>:1 [stakeholder, rule]' in r.stdout


def test_hook_edit_reports_only_edited_paragraph(tmp_path):
    f = tmp_path / 'doc.md'
    f.write_text('The stakeholders agree.\n\nWe will utilise the spare room.\n')
    payload = {'hook_event_name': 'PostToolUse', 'tool_name': 'Edit',
               'tool_input': {'file_path': str(f), 'new_string': 'We will utilise the spare room.'}}
    path, fs = pl.hook_findings(payload, CFG)
    assert [x.rule for x in fs] == ['plain-english']
    out = pl.hook_output(path, fs, CFG)
    assert 'additionalContext' in out['hookSpecificOutput']


def test_hook_never_fails():
    r = run('--hook', stdin='{not json')
    assert r.returncode == 0 and 'prose-lint failed' in r.stdout


def test_builtin_rules_file_is_valid():
    assert pl.load_rules()['rule']
    assert pl.read_hook_input(io.StringIO('{"a": 1}')) == {'a': 1}


# ---- findings from review -----------------------------------------------------------------

def test_all_purpose_verb_is_off_by_default_and_can_be_enabled(tmp_path):
    assert 'all-purpose-verb' not in ids('The menu carries a vegetarian option.\n')
    extra = tmp_path / 'p.toml'
    extra.write_text('enable = ["all-purpose-verb"]\n')
    assert 'all-purpose-verb' in ids('The menu carries a vegetarian option.\n', pl.load_rules([str(extra)]))


@pytest.mark.parametrize('text', ['We settled on a date in May.', 'The parties are settling the invoice.',
                                  'The model predicts demand.', 'This process takes ten minutes.',
                                  'The train journey takes two hours.', 'The chair sits on the board.'])
def test_literal_uses_are_not_flagged(text):
    assert ids(text + '\n') == [], ids(text + '\n')


def test_evaluative_settles_still_flagged():
    assert 'evaluative-filler' in ids('This settles the question.\n')


def test_bullet_starting_with_code_is_not_lower_case():
    assert ids('- `--rules` is repeatable.\n- `Python` reads the file.\n') == []


def test_blockquotes_and_indented_code_are_not_prose():
    assert ids('> The witness said: "we don\'t know \u2014 truly."\n\n    x \u2014 y\n') == []


def test_plain_text_indented_lines_are_prose():
    assert 'em-dash' in [f.rule for f in pl.check_text('    Indented \u2014 text.\n', CFG, plain=True)]


def test_opening_rule_is_not_front_matter():
    assert 'contraction' in ids("---\n\nWe don't agree.\n")
    assert 'contraction' in [f.rule for f in pl.check_text("---\n\nWe don't agree.\n", CFG, plain=True)]


def test_markdown_examples_do_not_hide_the_rest():
    assert 'contraction' in ids("Write `<!--` to open.\n\nWe don't agree.\n")
    assert 'contraction' in ids("```\n<!-- prose-lint-disable -->\n```\n\nWe don't agree.\n")
    assert ids("````md\n```\nWe don't \u2014 agree.\n```\n````\n") == []


def test_sentence_end_inside_quotes_and_emphasis():
    ten = 'word ' * 10
    assert sentences('It ended with ' + ten + 'recommendations.\u201d The board ' + ten + 'agreed.') == [
        'It ended with ' + ten + 'recommendations.\u201d', 'The board ' + ten + 'agreed.']
    assert 'long-sentence' not in ids('**The panel made its ' + ten + 'findings.** The board ' + ten + 'agreed.\n')


def test_finding_line_within_a_wrapped_paragraph():
    text = 'Intro.\nThe board\nwill meet in June ' + 'word ' * 25 + 'end.\n\nThe board will meet in June.\n'
    assert [(f.line, f.rule) for f in pl.check_text(text, CFG)] == [(2, 'long-sentence')]


def test_reference_image_is_fast():
    text = 'Text.\n\n[img]: data:image/png;base64,' + 'A' * 40000 + '\n'
    start = time.time()
    pl.check_text(text, CFG)
    assert time.time() - start < 0.5


def hook(tmp_path, text, new, response=None):
    f = tmp_path / 'doc.md'
    f.write_text(text)
    payload = {'tool_name': 'Edit', 'tool_input': {'file_path': str(f), 'new_string': new}}
    if response is not None:
        payload['tool_response'] = response
    return [(x.line, x.rule) for x in pl.hook_findings(payload, CFG)[1]]


def test_hook_edit_does_not_report_the_next_bullet_or_the_heading(tmp_path):
    assert hook(tmp_path, "- Accepted.\n- We don't agree.\n", '- Accepted.\n') == []
    assert hook(tmp_path, '# A \u2014 B\n\nWe agree.\n', 'We agree.') == []


def test_hook_edit_with_ambiguous_text_checks_only_the_new_text(tmp_path):
    assert hook(tmp_path, "We don't go to it.\n\nWe go to it now.\n", 'to it') == []


def test_hook_edit_uses_the_structured_patch(tmp_path):
    text = "We don't agree.\n\nThe stakeholders agree.\n"
    patch = {'structuredPatch': [{'oldStart': 1, 'oldLines': 3, 'newStart': 1, 'newLines': 3,
                                  'lines': [" We don't agree.", ' ', '-The board agrees.', '+The stakeholders agree.']}]}
    assert hook(tmp_path, text, 'The stakeholders agree.', patch) == [(3, 'stakeholder')]


def test_hook_deletion_that_joins_paragraphs_is_checked(tmp_path):
    one = ' '.join(f'Sentence {i} is here.' for i in range(4))
    two = ' '.join(f'Sentence {i} is here.' for i in range(4, 7))
    patch = {'structuredPatch': [{'oldStart': 1, 'oldLines': 3, 'newStart': 1, 'newLines': 2,
                                  'lines': [' ' + one, '-', ' ' + two]}]}
    assert (1, 'long-paragraph') in hook(tmp_path, one + '\n' + two + '\n', '', patch)


def test_hook_cap_shows_rule_findings_first():
    fs = [pl.Finding(n, 'long-sentence', 'warn', 'x', 'm') for n in range(1, 12)] + [pl.Finding(20, 'contraction', 'rule', 'y', 'm')]
    body = pl.hook_output('d.md', fs, CFG)['hookSpecificOutput']['additionalContext']
    assert 'd.md:20 [contraction' in body and body.index('contraction') < body.index('long-sentence')


def test_hook_input_split_utf8():
    payload = json.dumps({'tool_input': {'new_string': 'x' * 4080 + '\u2014 done'}}, ensure_ascii=False).encode()

    class Raw:
        def __init__(self, data):
            self.data = data
        def read1(self, n):
            chunk, self.data = self.data[:n], self.data[n:]
            return chunk

    class Stream:
        buffer = Raw(payload)

    assert pl.read_hook_input(Stream())['tool_input']['new_string'].endswith('\u2014 done')


# ---- findings from the recheck ----------------------------------------------------------

def test_paragraph_after_a_code_only_list_item_is_not_a_bullet():
    assert ids('- ```\n  code\n  ```\n\nthe next paragraph starts in lower case.\n') == []


def test_replacement_patch_does_not_pull_in_the_line_above(tmp_path):
    text = '# A \u2014 B\nWe agree.\n'
    patch = {'structuredPatch': [{'oldStart': 1, 'oldLines': 2, 'newStart': 1, 'newLines': 2,
                                  'lines': [' # A \u2014 B', '-We disagree.', '+We agree.']}]}
    assert hook(tmp_path, text, 'We agree.', patch) == []


def test_rule_then_prose_then_rule_is_not_front_matter():
    assert 'contraction' in ids("---\nWe don't agree.\n\n---\n")
    assert ids('---\ntitle: A \u2014 B\n---\n\nText.\n') == []


def test_hook_input_one_byte_reads():
    data = json.dumps({'k': 'caf\u00e9 \u2014'}, ensure_ascii=False).encode()

    class Raw:
        def __init__(self):
            self.data = data
        def read1(self, n):
            chunk, self.data = self.data[:1], self.data[1:]
            return chunk

    class Stream:
        buffer = Raw()

    assert pl.read_hook_input(Stream()) == {'k': 'caf\u00e9 \u2014'}


def test_technical_actions_are_not_personification():
    assert ids('The method determines the concentration of phosphate. The process checks the checksum.\n') == []


# ---- findings from the code review ------------------------------------------------------

def test_autolink_address_is_not_prose():
    assert ids('Write to <stakeholders@example.org> for the current copy.\n') == []


def test_leftovers_inside_code_and_comments_are_ignored():
    assert ids('Write ``{{customer}}`` in the template.\n') == []
    assert ids('Text <!-- a\n[TBD] --> more.\n') == []
    assert 'chatbot-artefact' in ids('Text.\n\nThe figure is [TBD].\n')


def test_deleting_a_bullet_does_not_report_its_neighbours(tmp_path):
    text = "- We don't agree.\n- The third.\n"
    patch = {'structuredPatch': [{'oldStart': 1, 'oldLines': 3, 'newStart': 1, 'newLines': 2,
                                  'lines': [" - We don't agree.", '-- The second.', ' - The third.']}]}
    assert hook(tmp_path, text, '', patch) == []


def test_deleting_a_line_inside_a_paragraph_reports_it(tmp_path):
    text = "We agree.\nWe don't know.\n"
    patch = {'structuredPatch': [{'oldStart': 1, 'oldLines': 3, 'newStart': 1, 'newLines': 2,
                                  'lines': [' We agree.', '-Something else.', " We don't know."]}]}
    assert hook(tmp_path, text, '', patch) == [(2, 'contraction')]


# ---- findings from Copilot's review -------------------------------------------------------

def test_deleting_the_first_or_last_line_of_a_paragraph_reports_it(tmp_path):
    body = [f'Sentence {i} is here.' for i in range(1, 7)]
    patch = {'structuredPatch': [{'oldStart': 1, 'oldLines': 4, 'newStart': 1, 'newLines': 3,
                                  'lines': [' Intro.', ' ', '-Sentence 0 is here.', ' ' + body[0]]}]}
    assert (3, 'long-paragraph') in hook(tmp_path, 'Intro.\n\n' + '\n'.join(body) + '\n', '', patch)
    patch = {'structuredPatch': [{'oldStart': 6, 'oldLines': 3, 'newStart': 6, 'newLines': 2,
                                  'lines': [' ' + body[5], '-Sentence 7 is here.', ' ']}]}
    assert (1, 'long-paragraph') in hook(tmp_path, '\n'.join(body) + '\n\nNext.\n', '', patch)


def test_software_dialog_box_keeps_its_spelling():
    assert ids('The software dialog box opens, and the print dialog closes.\n') == []
    fs = [f for f in pl.check_text('The dialog between the parties continues.\n', CFG) if f.rule == 'us-spelling']
    assert len(fs) == 1 and "'dialogue'" in fs[0].message


def test_dialog_rule_follows_us_spelling_disable(tmp_path):
    extra = tmp_path / 'p.toml'
    extra.write_text('disable = ["us-spelling"]\n')
    assert ids('The dialog continues.\n', pl.load_rules([str(extra)])) == []


# ---- issue 87: found in review and trial ----------------------------------------------------

def test_report_gives_each_finding_its_own_detail(tmp_path):
    f = tmp_path / 'r.md'
    f.write_text(' '.join(['word'] * 28) + '.\n\n' + ' '.join(['word'] * 35) + '.\n')
    out = run('--format', 'report', '--fail-on', 'never', str(f)).stdout
    assert pl.RULE_SUMMARY['long-sentence'] in out
    assert '(28 words:' in out and '(35 words:' in out


def test_report_flags_an_average_below_the_range(tmp_path):
    f = tmp_path / 'r.md'
    f.write_text('We met. We agreed. We left early.\n')
    assert 'below the range' in run('--format', 'report', '--fail-on', 'never', str(f)).stdout


def test_paragraph_cluster_quotes_the_sentence_that_holds_it():
    text = 'We met on Monday.\nWe agreed because it was late. We left because it rained. We stayed because they asked.\n'
    fs = [f for f in pl.check_text(text, CFG) if f.rule == 'justification-cluster']
    assert len(fs) == 1 and fs[0].line == 2 and fs[0].excerpt.startswith('We agreed because')


def test_lead_in_ending_with_a_full_stop_is_a_lead_in():
    assert 'announced-count' in ids('Two events this year show the limits.\n\n- The flood\n- The fire\n')


def test_trailing_conjunction_on_an_item_other_than_the_last():
    got = ids('- Approve the funding; and\n- Sign the contract, or\n- Close the file.\n')
    assert got.count('bullet-trailing-conjunction') == 2
    assert 'bullet-trailing-conjunction' not in ids('- Approve the funding\n- Sign it and\n')
    assert 'bullet-trailing-conjunction' not in ids('- A passport\n- A driving licence\n')


def test_trailing_conjunction_in_a_nested_list():
    got = ids('- The first, or\n  - A detail\n  - Another detail\n- The second\n')
    assert got.count('bullet-trailing-conjunction') == 1


def test_deleting_a_heading_above_its_paragraph_does_not_report_it(tmp_path):
    patch = {'structuredPatch': [{'oldStart': 1, 'oldLines': 2, 'newStart': 1, 'newLines': 1,
                                  'lines': ['-# Old heading', " We don't agree."]}]}
    assert hook(tmp_path, "We don't agree.\n", '', patch) == []


def test_trailing_conjunction_behind_markup():
    assert 'bullet-trailing-conjunction' in ids('- Approve the funding; **and**\n- Sign it\n')
    assert 'bullet-trailing-conjunction' in ids('- Approve the funding and <!-- note -->\n- Sign it\n')


def test_suppression_above_a_paragraph_covers_its_paragraph_finding():
    text = ('<!-- prose-lint-disable-next-line justification-cluster -->\nWe met on Monday and talked.\n'
            'We agreed because it was late. We left because it rained. We stayed because they asked.\n')
    assert 'justification-cluster' not in ids(text)


def test_paragraph_cluster_points_at_a_late_clause():
    text = ('We met on Monday. ' + 'The committee then reviewed the long list of outstanding items at some length '
            'and agreed because it was late.\nWe left because it rained. We stayed because they asked.\n')
    fs = [f for f in pl.check_text(text, CFG) if f.rule == 'justification-cluster' and 'paragraph' in f.message]
    assert len(fs) == 1 and 'because' in fs[0].excerpt


def test_report_average_at_the_boundary_is_not_below(tmp_path):
    f = tmp_path / 'r.md'
    # 20 sentences of 15 words and one of 14: an average of 14.95, shown as 15.0.
    f.write_text(' '.join([' '.join(['Word'] * 15) + '.'] * 20 + [' '.join(['Word'] * 14) + '.']) + '\n')
    assert 'averaging 15.0 words' in run('--format', 'report', '--fail-on', 'never', str(f)).stdout
    assert 'below the range' not in run('--format', 'report', '--fail-on', 'never', str(f)).stdout
