# Copilot labs: AI Ethics and Document AI

The Playground is the worksheet beside Microsoft Copilot: copy a prompt, paste it into Copilot, tick what Copilot
did. The Playground makes no AI calls in these labs and stores only ticks, choices and short notes.

| Type id | Label | Content |
|---|---|---|
| `copilot-ethics` | Copilot: AI Ethics | `frontend/components/CopilotLab/activities/ethics.ts` |
| `copilot-document-ai` | Copilot: Document AI | `frontend/components/CopilotLab/activities/documentAi.ts` |

## Decisions

- The projects list no longer shows "Model Trained" for Day 2 projects (changed on main before this work). Copilot
  cards show "Result saved: Yes / Not yet" instead, true once the lab has a saved, completed step.
- Where the spec and the design preview differ, the spec's wording is used (for example Step 2's hint "Then paste
  Copilot's redacted email from Step 1 under it.", Ex 9 Step 3 "Ask about the circular directly", Ex 10's
  "Another date or none" and the payment-date answer text).
- A prompt card shows its own hint when the step gives one; otherwise the default "Paste this into Copilot. Start a
  **new chat** first." (Showing both would contradict "Send this in the same chat".)
- `CopilotLab.preview.jsx` is kept as the design reference (not routed). Its inline CSS string was replaced by an
  import of `copilotLab.css`, which holds the same rules scoped under `.cpl`, so the two can't drift apart.
- The notice PDF was not in the repo, so it was generated with `frontend/scripts/make_seabird_notice.py` (reportlab).
  The script tries DejaVu (Linux), then Arial (Windows, macOS), since the spec's DejaVu path doesn't exist on Windows.
  Replace the PDF with Usha's when it arrives; the download card says "1 page · PDF · 74 KB".
- Scoring lives in `scoring.ts` (pure), shared by the UI and `scripts/test-copilot-lab.ts`. The result row for the
  field check reads "Got N of 10"; under the table: "Copilot got N of 10. The misses are what a person must check."
- Saving: 800 ms after the last change, on every step change and when leaving the page. If the backend can't be
  reached, the answers stay in localStorage (`copilot-lab:{projectId}`) and the top bar says "Saved on this device";
  the next change retries, and a later visit pushes those answers to the server.
- Commits B and C don't build on their own: `activities/index.ts` imports both labs' content, which lands in C and D.
- Print: only the result card or the AI check is printed, with the light theme's colours on white paper, and the
  full card layout is kept even though A4 is narrower than the app's 900 px small-screen breakpoint. Both fit one
  A4 page (checked by printing to PDF: `docs/copilot-labs-screens/print-*.pdf`).
- On Windows the clipboard stores line breaks as CRLF, so a pasted prompt has CRLF line endings; the text is
  otherwise exactly the prompt (checked in headless Chrome).

## Tests

- Backend: `cd backend && .venv/Scripts/python.exe -m unittest test_copilot_lab -v` (10 tests, offline).
- Frontend: `npm run test:copilot-lab` (9 tests: step-done rules, chip colours, field-check scoring, Copy result
  text, every choice has a verdict, every field row a key, AI-check ids). `npm run lint` and `npx tsc --noEmit` pass.
- The full backend suite has 11 failures in the exercise-lab tests on `main` too; `test_exercises_vision`'s
  subfolder test errors only in the full run (it passes alone).
- Screenshots (1366×768, every step of both labs, dark and light): `docs/copilot-labs-screens/`.
