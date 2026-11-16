# Repository facts: <owner>/<repository>

Derived at <commit>, <date>. Facts marked (checked) are re-verified by the lead
before each batch. Only what the code and GitHub cannot tell an agent directly
belongs here. State a default and its exceptions, never an absolute; do not copy
a number that lives somewhere else.

How sessions work and what they may do is in the `cloud` skills and `CLAUDE.md`.
This file is about this repository.

## Commands

- Full verification (checked): `<the command that runs every test>`. About <n>
  tests, <how long>.
- Provisioning a fresh checkout: <what a new clone needs before the tests run>.

## Known failures and intermittents

- None known.

## Hazards

- <Anything that has bitten a lane: a file every change appends to, a test that
  passes alone and fails when lanes combine, a command that behaves differently
  in a cloud session. Cite the issue or pull request that showed it.>

## Conventions the code follows

- <Rules the code keeps that an agent would not guess from reading one file.>

## Checks that run on a pull request

- <Each check, and whether it must succeed.>

## Checks the owner wants before merge

- None specific to this repository.

## Branch protection (checked)

- Default branch `<main>`. <Whether a pull request is required, whether review
  threads must be resolved, which status checks are required, whether a branch
  must be up to date.>
