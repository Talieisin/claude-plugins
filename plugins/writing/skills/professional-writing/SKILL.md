---
name: professional-writing
description: Standards and a working method for formal British professional writing (reports, proposals, technical and policy documents, briefings and correspondence). Covers establishing the substance before drafting, drafting craft, register and diction, structure, punctuation, commercial framing, preserving meaning through revision, and comparative review. Use when drafting, rewriting, editing or reviewing formal documents (reports, proposals, policy documents, briefings, letters), unless a client or house style says otherwise; not for commit messages, pull requests, issue comments or code comments, unless asked.
---

<!-- professional-writing-skill-version: 4 -->

# Professional writing

This skill sets out how to write and review formal professional prose for a senior, expert reader. That reader may be a director, a specialist or a client, and must understand the text and act on it. The skill assumes no tools: you can make every check below by reading. Where a shell is available, the accompanying linter (`tools/prose-lint/`) automates the checks that a pattern can find, and its README names the optional companion tools.

## Precedence

1. A client's or organisation's own style guide, and the document owner's house conventions, override any rule in this skill wherever they conflict, mechanics included.
2. The author's explicit instructions and stated preferences for the document override all of these.
3. This skill applies wherever they are silent. Where the linter checks a rule that local style sets aside, a project rules file turns the check off (see the linter's README).

A required length never licenses adding what the source does not give. Where the source cannot reach it, deliver what the source supports and report the shortfall to the author.

Whatever this skill says, keep direct quotations, official names, the titles of documents and terms the source requires exactly as they are.

The default is British English with -ise spellings (organise, programme, licence as a noun, practise as a verb). Oxford spelling (organize) is also British; follow it, or any other convention, where the document's owner sets one.

## The working method

The brief does more for the result than any later correction. A text written to a clear brief, at a stated length and with its enumerations set as lists, reads better than one produced by repeatedly editing earlier prose. Most of the effort belongs before the first sentence.

### 1. Establish the reader and the purpose

Before writing, state to yourself:

- Who reads the document, what they already know and what they must do after reading it
- What the document must establish, decide or request
- What it must not do (commit to something outside the author's control, for example).

Write to expert readers as peers. Use the terms they already own without glossing them, and do not explain what they know. Plain English governs sentence structure; it is not a reason to simplify vocabulary the reader uses daily.

### 2. Establish what the text must say

From the brief and the source material, identify the substance the text must convey before choosing any words:

- The commitments, and who makes each one
- The parties, and who does what
- The conditions and limits, with their modal verbs exactly as meant: *must*, *may*, *should*, *will*, *until*, *subject to*. Most errors of meaning in professional prose are lost or shifted modals and conditions.
- The numbers, dates and facts
- The members of every list, each of which must appear.

Do not supply an actor, a number or a condition that the source leaves unstated: put it to the author as a question. A figure worked out from figures the source gives is not new. Where the brief asks you to recommend or propose, write the proposal in the text. Mark it as proposed ("we propose", "the recommended option") so that the author can accept or reject it. Questions for the author go in your reply or in comments beside the text, never in the text the readers will read.

### 3. Draft

- Elaborate where the reader needs it: explanation, connection and context are welcome. Arithmetic on figures the source gives (a total, an annual cost) and general explanation of how something works are elaboration.
- Never add a commitment, a party, a condition, a number or a fact about the matter in hand that the source does not give. The exception is a proposal the brief asks for, marked as proposed. Where the text seems to need one, put it to the author as a question.
- Keep to a length ceiling where one is set. A first draft usually improves by losing a third of its length. Where the source cannot fill a set length, stop short and tell the author. Reaching it would take padding or invention.

Two drafts of the same brief often find a better structure than one, but only if they are independent. Where both a second writer and a separate comparer are available, give the second writer the same brief and source material but not your draft. Have the comparer judge the two blind (see Review, below), and keep the better one. Otherwise, write one draft.

### 4. Check meaning, then readability

Every rewrite loses some meaning, and condensing loses most. Whenever you revise existing text, check the new version against the old one before polishing it:

- **Contradictions first:** any statement that conflicts with the previous version, with the source, or with another statement in the revision
- **Each point of substance:** kept (meaning, modal and conditions intact), weakened (a qualifier, actor, modal, condition or list member lost or changed) or dropped
- **Each addition:** an *elaboration* (adds no commitment, party, condition, number or fact about the matter in hand; arithmetic on given figures and general explanation count as elaboration) or a *new claim*.

Fix contradictions, restore anything weakened or dropped unintentionally, and keep elaborations unless they contradict or weaken a point. Put every new claim to the author as a question, unless it is a proposal the brief asked for and is marked as proposed. Then turn to readability and the checklist at the end of this skill.

Readability and fidelity are separate tests. The best-reading version in a comparison can be the one that lost the most meaning, so never let a better read stand in for the meaning check.

## Drafting craft

These are the positive rules. Applying them makes most of the prohibitions later in this skill unnecessary.

- **Name the responsible party first, then what it does.** "The board approves the plan", not "approval of the plan is obtained". An agentless passive hides who acts; use one only where the actor is genuinely unknown or irrelevant.
- **Do not make an abstraction the actor for a decision or a responsibility.** A method, framework, process, policy or document does not decide, approve, prepare or keep anything: a person or body does. Name the party that acts, or make the thing acted on the subject. A document may define, state, include or require something ("The handbook defines the dress code"; "the contract requires approval"), and a model may predict, but "the handbook decides who may work from home" is wrong.
- **Choose the literal verb for the relationship, and do not let one verb do several jobs.** A report *includes* a summary; a contract *requires* approval; a cellar *contains* the wine; a timetable *lists* the departures. All-purpose verbs (*carry*, *hold*, *sit*, *rest on*) are the commonest failure.
- **Give each sentence one governing claim.** When the actor, condition or stage changes, start a new sentence rather than repunctuating an overloaded one.
- **Express actions as finite verbs, not abstract nouns.** "We will interview the applicants", not "the interviewing of the applicants will be undertaken". Words ending in *-ion* and *-ment* are a warning sign, not a prohibition: *approval*, *payment* and *agreement* are correct where they name a thing rather than disguise an action.
- **Vary sentence length deliberately.** Aim for an average of 15 to 20 words. Treat 25 words as a prompt to check the structure, not as a limit: a long sentence with one clear subject and one claim is better than two clipped ones. Do not split sentences only to clear a length warning. A run of short, flat sentences reads as abrupt and staccato to a professional reader.
- **Write connected prose.** Each sentence should follow from the last. Reasoning set out as a series of separate assertions reads worse than the same reasoning with its connections stated.
- **Attach each qualification to the commitment it limits**, using *if*, *until*, *may* or *subject to*, rather than stating it separately and leaving the reader to connect them.
- **Choose diction that is plain but professionally precise.** The correction for abstraction is the exact word, not the simplest one: *define*, *specify*, *assess*, *establish* and *populate* are right where *say*, *check*, *fill in* and *sort out* are too casual. Replacing a tortuous phrase with a conversational one is a different failure, not a fix.
- **Say each thing once.** Do not follow a sentence with a shorter one that restates it.
- **Name each concept one way.** Synonym cycling (the review, the assessment, the evaluation, for one thing) makes the reader wonder whether these are different things. Define a term once and keep to it.

### Before and after

| Failure | Before | After |
|---|---|---|
| Evasive verb | The menu carries a vegetarian option, which sits alongside the set courses | The menu includes a vegetarian option alongside the set courses |
| Buried responsibility | Approval of the route by the club secretary is required before tickets can be issued by the treasurer | The club secretary must approve the route before the treasurer can issue tickets |
| Stacked infinitives | The committee's task is to choose the venue, to agree the menu and to confirm the guest list | The committee chooses the venue, agrees the menu and confirms the guest list |
| Abstraction as actor | The scheme decides, through its judges, which gardens win a prize | The scheme's judges decide which gardens win a prize |
| Figurative verb | The festival rests on good weather | The festival depends on good weather |
| Announced count | Three factors determine the price: | The price depends on: |
| Significance inflation | It is crucial to note that the caterers cannot arrive before 2pm, when the hall booking starts | The caterers cannot arrive before 2pm, when the hall booking starts |
| Separated qualification | The shop will deliver the sofa on Friday. This assumes payment clears by Wednesday. | The shop will deliver the sofa on Friday, provided that payment clears by Wednesday |

## Structure and layout

- **Put the point first.** Open each section with what its subject is, why the reader needs it and who is responsible. Do not open with a list's lead-in, a term not yet defined, a cross-reference, an exclusion, a restatement of the heading or "this section describes".
- **A document that asks for a decision opens with the decision sought.** Where the request has three or more parts, set them out as a list, with each item's amount where it has one and any totals worked out from the figures given. Say plainly that a matter still undecided is open; in a longer document, give it its own heading. Among the options it sets out, include doing nothing, with the consequences the source gives; where it gives none, ask the author.
- **A paragraph develops one idea.** Avoid a one-line paragraph left dangling after a longer one, unless the sentence does a job of its own, such as a closing request. More than five or six sentences usually means two ideas.
- **Use lists for genuine enumerations**: three or more substantial parallel items, tests, stages or requirements. A short series that reads naturally in the sentence ("cost, time and quality") stays in the sentence. A verbless chain of clauses separated by semicolons is a list in disguise and should be bulleted.
- **Do not over-fragment.** Structure helps up to a point and then hurts. Too many bullets, headings or very short paragraphs break an argument that needs connected prose. Fragmented text can look easy to scan while reading worse. When in doubt, write the paragraph.
- **Introduce a list without counting it**, unless the number is itself a defined thing (the four seasons, the two halves of a match). "The price depends on:" rather than "Three factors determine the price:".
- **Headings** are in sentence case, short and descriptive. Do not add subheadings for a few paragraphs, and never use an abbreviation in a heading.
- **Tables** suit comparisons and attribute lists; prose suits reasoning. Give tables and figures numbered captions and refer to each in the text. A comparison table may repeat figures the text gives, so that the reader can set them side by side; the reasoning stays in the text.
- **Figures illustrate what the text explains.** A figure has only labels, short annotations and a legend for its abbreviations. It never restates the body text, and the text never relies on the figure alone to make a point.
- **Cross-references** are built into the sentence that makes the point ("The appendix gives each recipe"), not appended as pointers ("…, as described in Section 4").
- **References:** cite the sources a point depends on in the text, and put minor points in footnotes.

## Register and diction

The register is formal, measured, concise and precise: a considered professional voice, not a simplified one, and never a promotional one.

- **No contractions** in formal documents ("do not", never "don't").
- **No marketing or floral language**: *world-class*, *cutting-edge*, *best-in-class*, *unlock*, *empower*, *journey*, *holistic*, *synergy*.
- **No significance inflation**: *critical*, *crucial*, *fundamental*, *pivotal*, *it is important to note*, *it is worth noting*. If something is important, the consequence shows it; state the consequence.
- **Bold sparingly**: field labels and defined terms only, never for emphasis.
- **Name groups precisely.** Write "the residents", "the parents' committee" or "the site managers", not "stakeholders".

### Use the ordinary, literal word

Reaching for a more interesting verb reads as affectation. Avoid figurative or coined shorthand wherever a plain word exists:

| Avoid | Prefer |
|---|---|
| rests on, sits on, turns on | depends on, assumes, is based on |
| sits between, sits within | lies between, is part of |
| falls away | no longer applies |
| travels with, carries | accompanies, includes, contains |
| holds (for contents) | contains |
| pinned to | fixed to, tied to |
| cuts across | affects, applies to |
| bites | takes effect, constrains |
| lands, landing (a decision or change) | is agreed, takes effect, is delivered |
| hand back | return |
| de-risk | reduce the risk of |
| north star, low-hanging fruit, move the needle, deep dive | an aim, an easy gain, make a measurable difference, a detailed review |

A fixed expression keeps its sense ("on hold", "carry out", a "holding company").

### Words and phrases that mark machine-written or careless prose

Avoid these unless the literal sense is meant:

- Words such as *delve*, *tapestry*, *landscape* (figurative), *navigate* (figurative), *seamless*, *robust* (as filler), *load-bearing*, *serves as* (write *is*), *boasts* (write *has*), *in today's…* and *leverage* as a verb (write *use* or *draw on*)
- The evaluative senses of *matters* and *settles* ("the distinction matters", "this settles the question"), and *stands as* ("its status stands as provisional"). Say what follows, or who decides.
- Habitual contrast crutches: "rather than", "not X but Y", "X, not Y" used for rhythm rather than meaning, and invented contrast pairs ("not a plan but a promise")
- Rhetorical punch: "here is the thing", "the short answer is", sentence fragments for effect
- Several sentences or paragraphs built to the same template.

### Words to replace (standard plain-English list)

| Avoid | Prefer |
|---|---|
| facilitate | help, enable, arrange |
| utilise | use |
| in order to, so as to | to |
| prior to, subsequent to | before, after |
| initiate, commence | begin, start |
| going forward | from now on, in future (or omit) |
| progress (as a verb) | advance, continue, take forward |
| key (figurative) | main, principal, essential |
| streamline | simplify, shorten |
| dialogue (for discussion) | discussion, talks |
| e.g., i.e. | for example, such as; that is, in other words |

Keep justification clauses ("so that", "because") to those the reader needs. Two in a sentence, or a cluster in a paragraph, usually signals over-explanation.

## Commercial writing (proposals, quotations, letters)

- **Say what you will do.** Each statement of scope answers "what will we do", not "what will we not do".
- **A scope exclusion** (work not done at all) belongs in the exclusions section, stated once. Do not repeat it in the assumptions, the activities or the working arrangements.
- **An operative qualification** (revision rounds, a feedback window, an effort bound, a dependency on another party) belongs beside the commitment it limits, where the reader can apply it.
- **State a boundary as the positive allocation** where it defines who does what: "The client's own staff supply the photographs" rather than "we will not take the photographs".
- **Do not commit to an outcome another party controls.** Commit to the work and state the aim: "We will prepare and submit the planning application and answer the council's queries", not "we will obtain planning permission".
- **State a constraint outside your control as a fact about the timetable**, not as a disclaimer: "approval is the client's decision, on the client's timetable", not "we cannot control when approval comes".
- **Bound anything open-ended**: attendance, ad hoc support and further revision need a limit, such as a stated count or "within the agreed effort". Take the limit from the source; where it gives none, ask the author for one rather than asserting an agreement.
- **Distinguish what the client formally accepts from what is shared for information.** Give each item for acceptance a description the client could test and an indicative date, taking the date from the source or asking the author for one. Say plainly which items are for information only.
- **List as an output only what reaches someone who needs it.** A working document of your own process is not an output, however much effort it takes. Every stage of the work produces something; a stage that produces nothing belongs to the stage its activities serve.
- **Do not recite the specification.** A proposal describes the shape and extent of the work and refers to the specification; it does not reproduce every required component as an activity.

## Punctuation and mechanics

Each convention in this section is a default. A style guide, a house convention or the author's stated preference overrides it (see Precedence).

### Dashes

- **Never use an em dash (—).** Prefer a full stop: when the actor, condition or stage changes, start a new sentence. Commas, colons, semicolons and parentheses are for genuine subordination, not for keeping an overloaded sentence going.
- **The en dash (–)** is used unspaced for ranges of numbers, dates and identifiers in tables, lists, figure labels, references and citations ("pages 6–8", "1990–95", "R1–R14"). A financial year takes the oblique stroke everywhere (2026/27).
- **In running prose, write ranges in words**: "from 1 to 30 April", "between 10 and 20 days", with the unit at both ends where it helps.
- **Never use a spaced en dash** ( – ) for any purpose: not for an aside, not to join clauses and not as a heading separator (use a colon).
- **Never use an en dash to relate two parties in prose.** Write "the interface between the client and the supplier", not "the client–supplier interface" (the short form is acceptable in a table or figure label).
- **Never use two hyphens** ( -- ) as a dash.

### Bullets

- Each item begins with a capital letter and takes no trailing semicolon or comma.
- Intermediate fragment items take no terminal punctuation; the final item ends with a full stop.
- Items that are full sentences keep their full stops.
- Items in a list are grammatically parallel and each completes the lead-in.
- No "and" or "or" at the end of the penultimate item. Where the way the items combine changes the meaning (alternatives, conditions, eligibility), say so in the lead-in ("all of the following", "one of the following"). Where the conjunction carries a condition the lead-in does not express, keep it.

### Abbreviations and capitals

- Spell out an abbreviation at first use, with the short form in brackets, then use the short form. If a term appears only once, do not abbreviate it. Widely understood forms (UK, EU, BBC, CEO) need no expansion.
- Do not capitalise a term merely to justify its abbreviation, and never invent an abbreviation.
- No apostrophe in a plural initialism (URLs, MPs).
- In a long document, spell out each abbreviation again at its first use in each chapter. Give each figure a legend for the abbreviations it uses, so that the figure can be read on its own.
- Capitals for proper nouns and formally defined terms only. Sentence case for titles and headings. No block capitals for emphasis.

### Numbers and dates

- One to ten in words, 11 and above in figures; figures throughout for money, measurements and percentages with a symbol. A precise duration or amount of effort is a measurement (5 minutes, 3 days); a general span follows the one-to-ten rule (three years, 15 years). Commas in numbers above 999.
- "Per cent" in prose; % beside a figure in tables.
- Never begin a sentence with a figure.
- Dates as 24 April 2026; spans written out ("1 April 2026 to 31 March 2027"); the 24-hour clock where precision is needed. Decades take no apostrophe (the 1980s).

### Other conventions

- No Oxford comma unless its absence would change the meaning.
- A semicolon joins two clauses that could each be a sentence; a colon introduces an explanation, a list or a quotation.
- Hyphenate a compound adjective before its noun (a user-focused service, a 30-year rule, a short-term gain), but not after an adverb ending in -ly (a totally enclosed system).
- Double quotation marks for direct quotation, single for a term used in an unusual sense, applied consistently. Many British publishers use the reverse, so follow the document's style where it sets one.
- Place a footnote marker after the punctuation, ideally at the end of the sentence.
- No "(s)" alternatives: write the plural, which covers one as well as several. An ampersand only in a formal name.
- *Fewer* for numbers and *less* for quantity. *More than* for quantities and *over* for position and age.
- Prefer *that* for a clause that restricts and *which*, with a comma, for one that adds. Decide which the writer means before changing the punctuation, because a comma turns a condition into a statement about every case.
- *Affect* is usually the verb and *effect* the noun, but *effect* is also a verb meaning to bring about ("the supplier must effect the transfer"). Check which is meant before changing it.
- *Different from*; *because of* over *due to*; *while* for simultaneity; *adviser*, not *advisor*.
- *Program* for software only, *programme* otherwise.
- Gender-neutral phrasing: rephrase, or use the singular *they*. Never infer a person's pronouns from their name.
- Close-set slashes (and/or is better reworded entirely).

## Review

### Compare; do not score

A reviewer, human or model, judges reliably which of two versions of the same text reads better. Nobody judges reliably how good a single passage is in absolute terms, or ranks different texts against each other. So:

- Review a revision by comparing it with its previous version, passage by passage, and say which reads better and why. Allow a tie where the reader would notice no difference.
- Do not grade a passage in isolation.
- Check meaning separately from readability, every time (see step 4 of the working method). Before calling a change a loss of meaning, check what the author said it was for, in the instructions or the change notes. A loss the author intended is not a defect. This is part of the meaning check: keep the notes from a blind comparer.
- After fixing review findings, compare the fixed text with the version before the fixes. A fix can make a sentence worse, and only that comparison shows it.
- If the text changes after a review, review it again rather than reconciling the old findings with the new text.
- Never drop a reviewer's finding silently. Where you disagree with one, put both views to the author.

### When asking another reviewer or model to compare drafts

- Label the drafts neutrally (Draft 1, Draft 2), never by origin ("old", "revised", "model A").
- Keep any key mapping labels to origins out of the reviewer's sight.
- Swap or randomise the order, and put the version you expect to lose first at least once. Labels and a fixed order can reverse the verdict.
- Give the reviewer only the material it needs. A reviewer that has seen the author's preferences or notes is no longer independent.
- Report a comparison as blind only when it was.

### Reviewing someone else's document

1. Read the whole document before marking anything. Judge audience fit and structure first.
2. Check sentence-level clarity: length, voice, visible actors, stacked sub-clauses, one claim per sentence.
3. Sweep for the word-level problems in this skill.
4. Check mechanics: abbreviations at first use, capitals, numbers, dates, bullets, captions, headings.
5. Apply the precedence rules before reporting a "defect" that local style has already decided differently.
6. Report each finding with its location, a short quotation, the rule breached and a proposed rewording in the same register.

## Final checklist

Before issuing any text, re-read it against this list. Style drifts over a long editing session, so re-read at the end, not only while drafting. Then read the finished text through, sentence by sentence, as its reader would (a person writing reads it aloud). Where possible, also give it to a reader who has not seen the brief or the drafts, and judge their comments against what the intended reader knows.

**Rules (unless local style sets otherwise: see Precedence)**
- No em dashes; no spaced en dashes; no double hyphens as dashes; en dashes only in ranges of numbers, dates and identifiers, and between words only in tables and figure labels
- No contractions, no *e.g.* or *i.e.*, no *stakeholder*
- No chat-interface leftovers: "Certainly!", "I hope this helps", "As an AI", citation markers such as 【1】 or [cite], unfilled placeholders such as [insert…], [TBD], [TODO] or {{…}}, and tracking parameters in links (utm_, fbclid, gclid)
- British spelling, unless the document's owner sets another convention
- Where the text is saved as a Markdown or text file and `uv` is available, the linter run over it (`uv run -q --script <this skill's folder>/tools/prose-lint/prose_lint.py <file>`), each "rule" finding fixed unless local style sets it aside, and each warning judged in context, as its README says. Where local style sets a rule aside, pass `--rules` with a file that disables it; a scratch file serves for one document.

**Meaning**
- Every mandatory point present, with its modal verbs and conditions intact
- No commitment, party, condition, number or fact about the matter in hand that the source did not give, except a requested proposal marked as such
- Each gap put to the author as a question, beside the text; arithmetic on given figures and general explanation kept as elaboration
- No length reached by padding: short of a set length the source cannot fill, with the author told
- No contradictions within the text or with the source.

**Sentences**
- Each sentence has one governing claim and a visible actor
- No abstraction (method, framework, process, document) acting as a person
- Sentences over 25 words checked for structure; length varied; no staccato runs
- No more than two passives in a sentence; no cluster of justification clauses
- No sentence that restates the one before.

**Words**
- Literal verbs; no *holds*, *carries*, *sits*, *rests on* where a plain word exists
- No figurative shorthand, AI-tell words, marketing language or significance inflation
- No *matters*, *settles* or *stands as* in their evaluative senses
- One name for each concept.

**Structure**
- The point first in each section and paragraph
- Lists only for genuine enumerations; no verbless semicolon chains; no announced counts unless the number is itself a defined thing
- Not over-fragmented: no dangling one-line paragraphs, no needless subheadings
- Bullets capitalised; fragment items unpunctuated until the final full stop; full-sentence items keep their full stops; how the items combine stated in the lead-in where it changes the meaning
- Tables and figures captioned, referred to in the text, and not restating its reasoning (a comparison table may repeat its figures).
