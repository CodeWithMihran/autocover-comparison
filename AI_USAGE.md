# AI usage log

This file records AI assistance for this assignment. Keep adding the prompts used during implementation, in order, and review the generated code before submission.

## Tools

- Claude AI — used by the candidate for an initial assignment breakdown. The original prompt to Claude was not included in the materials shared with Codex, so it cannot be reproduced here.
- OpenAI Codex desktop (including its web search tool) — used to inspect the copied README/data, implement the investigation notes and parsers, scaffold/repair the Vite app dependencies, and verify the project.
- Codex computer-use workflow — attempted a local visual preview; the browser could not reach the sandbox's localhost server, so build and lint checks were used instead.

## Main prompts in this work session

1. “What should I name the project and the github repo ??”
2. “Please understand all the thing in the best way possible and tell me the best next step to do”
3. “I have added them 
Please now check all the files in the best way possible”
4. “## Best next step

Before building the UI, write a short source investigation note and define your normalized plan fields—including how you represent missing GST, provider declines, quote expiry and Provider C’s calculated premiums. Then implement and verify the parsers against these files. This is the part of the assignment most likely to surface hidden edge cases early.



Can you do this for me please ??

If yes then do it in the best possible way



I am going to use (React + Typescript) which is preferred by them”
5. “Why are you using python for development ??
I have told you to use react and typescript na”
6. “So what to do next now ??
What should be the next possible step ??
Should I initialize react frontend using vite first into the frontend folder ??”
7. “OXlint or Eslint ??”
8. “PS D:\Mihran\Official Internship Projects\autocover-comparison> npm create vite@latest frontend -- --template react-ts

Need to install the following packages:
create-vite@9.3.3
Ok to proceed? (y) y

> autocover-comparison@1.0.0 npx
> cva frontend --template react-ts

create-vite v9.3.3

Target directory "frontend" is not empty. Please choose how to proceed: Ignore files and continue
Which linter to use? ESLint
Install with npm and start now? Yes

npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error Found: typescript@7.0.2
npm error Could not resolve dependency: peer typescript@">=4.8.4 <6.1.0" from typescript-eslint@8.72.1”
9. “Ok then do the nest step in the best possible way and try to make it clean, easy to use all the features and it should classic and good in the best way possible (You can use the color theme in the image I have provided if you want to or add another theme if you have better option)
Do your best,”
10. “Okay it is running, What should be the next best step ??”, followed by Codex was asked to implement the quote comparison step using the existing app.
11. “Can you read the readme or recommend me what should I do and add to make this project best and to be get selected in the internship please
Do your best”
12. “Before doing anything else I want you to check the entire codebase for any bugs and errors or logical errors in the best way possible to make the project flawless in every aspect.
Please do your best to find and fix them in the best way possible”
13. “I have never used or installed postgreSQL, i have used only MongoDB as a backend ?? Is it necessary to use SQL ?? Can we shift to mongodb ?? I already have mongodb compass and used mongodb atlas for many of my projects”
14. “Complete these two first in the best way possible and make it flawless: transparent comparison reasons using supplied data, and clear quote/data-quality indicators with source or calculation notes.”
15. “Now complete these two first in the best way possible and make it flawless: side-by-side comparison of two or three plans, and reliable partial results when a provider is slow or fails.”
16. “Now complete this feature in the best way possible: Saved comparisons. Let users save a comparison to revisit later, using MongoDB persistence, and make sure saving a confirmed policy works first.”
17. “Before doing anything else I want you to check the entire codebase for any bugs and errors or logical errors in the best way possible to make the project flawless in every aspect. Please do your best to find and fix them in the best way possible.”

## Review notes

- Codex initially summarized the assignment without the local files; after the files were added, the actual README and every source were inspected.
- An initial parser prototype was written in Python based on the assignment's suggested backend stack. After the candidate clarified they wanted React + TypeScript as their chosen stack, that prototype was archived and the active parser/API layer was moved to TypeScript/Node.
- The active TypeScript parsers use explicit nulls/warnings for missing tax details rather than inventing GST values.
- Provider C calculations are labeled as indicative and carry documented rounding/age assumptions.
- The Vite React + TypeScript scaffold installed with a TypeScript 7 range that conflicted with `typescript-eslint`'s declared `<6.1.0` support. The frontend is pinned to TypeScript 6.0.3; build and lint now pass.
- The AutoCover frontend includes registration lookup, editable vehicle review, provider quote loading, comparison, filtering, sorting, mock confirmation, and a saved-policy dashboard backed by MongoDB. Provider endpoints parse the supplied files; Provider B is delayed and Provider D has configurable intermittent failures.
- After the user requested an assignment-versus-code review, Codex re-read the copied assignment README, added database policy storage and policy date logic, the add-on glossary using three official insurer pages, add-on filtering and explainable plan standouts, and updated setup/documentation.
- AI-generated changes were reviewed and corrected where needed: a UI ranking label was changed to honest provider order, unknown add-on meaning stays unknown, quote confirmation re-parses and verifies the selected plan from supplied data, and the leap-day policy-term boundary received a regression test.
- During the code review pass, Codex tightened date and money parsing, tax-note handling, tax attribution, policy request validation, retryable database initialization, database connection cleanup, quote identity and add-on concept filtering, Provider C effective-date validity, and provider error/warning display. New regression tests cover malformed source fields and boundary validation.
- After the candidate requested MongoDB based on their experience with MongoDB Compass and Atlas, Codex replaced PostgreSQL persistence with the official MongoDB Node.js driver, configured automatic collection/index setup, removed the SQL migration and Compose database, and rewrote the setup instructions for local MongoDB Server or Atlas.
- In response to the candidate's request to complete transparent comparison reasons and clearer quote/data-quality indicators, Codex updated plan cards to explain relative premium and IDV strengths only against currently shown, comparable coverage cohorts; listed mapped add-ons and provider-supplied benefits as reasons; exposed quote validity/expiry, missing values, file and calculation basis, warnings, provider errors/retries, and excluded expired quotes.
- In response to the follow-up feature request, Codex added independent two/three-plan comparison selection and a focused accessible comparison table, distinct from policy selection. Provider requests run concurrently and independently update their provider state; per-provider request versions prevent late responses from overwriting a newer retry or comparison. Statuses show provider-specific failure details and individually labeled retries while successful providers' plans remain visible.
- In response to the saved-comparisons request, Codex added MongoDB-backed comparison snapshots, validates request shape and re-verifies each plan against its provider's supplied source before saving, lists saved snapshots with policies, and adds a read-only revisit view that labels historical data as a snapshot. Policy persistence remains in its existing collection and route. A live MongoDB integration run still requires the candidate's local MongoDB service or Atlas URI.
- During the latest full audit, Codex fixed safe-integer handling for parsed money, strict comma grouping, ambiguous Provider A premium/GST representations and malformed JSON rows, ambiguous Provider B tax notes, vehicle expiry-before-registration validation, API port/body-abort handling, provider retry preservation of prior results, independent dashboard loading errors, and selected-source quote verification shared by policy and comparison saves. Added regression tests for these cases and saved-comparison request validation.
- The app still needs a MongoDB-backed manual run and screenshots or a short demo recording before submission.
