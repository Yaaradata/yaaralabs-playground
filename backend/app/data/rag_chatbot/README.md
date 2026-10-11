# RAG Chatbot data

## Library (`library/*.json`)

The library holds official SEBI circulars, downloaded from sebi.gov.in and stored as text, page by page. They are built by `backend/scripts/build_rag_library.py RAW_DIR`, which uses the same PDF extraction as a learner's upload.

| id | Document | Reference | Date | Pages | Words |
|---|---|---|---|---|---|
| sebi-custodian-guidelines-2026 | Guidelines for Custodians | HO/19/(1)2025-AFD-FPICELL/I/5928/2026 | 4 Mar 2026 (in force 24 Mar 2026) | 10 | 2,399 |
| sebi-t0-beta-2024 | Beta version of T+0 rolling settlement cycle (optional) | SEBI/HO/MRD/MRD-PoD-3/P/CIR/2024/20 | 21 Mar 2024 | 4 | 798 |

Sources:
- https://www.sebi.gov.in/legal/circulars/mar-2026/guidelines-for-custodians_100118.html
- https://www.sebi.gov.in/legal/circulars/mar-2024/introduction-of-beta-version-of-t-0-rolling-settlement-cycle-on-optional-basis-in-addition-to-the-existing-t-1-settlement-cycle-in-equity-cash-markets_82455.html

On first use the library is written to Firestore (`rag_library/{id}` plus `pages/{0001}`). It is rewritten whenever a file's `version`, a hash of its page text, changes.

## Test set (`test_questions.json`)

There are 12 questions: 8 fact questions checked against the circulars, and 4 traps whose answers are in neither document. Each question has an automatic `check`:
- `all`: every group must appear in the answer.
- `any` with `min`: at least that many groups must appear, as in "name two of these five".
- `trap`: the answer passes only if it says the documents don't cover it.

The expected answers were verified against the official text. One nuance: para 5.5.6 requires DR drills "for at least 1 working day in a year".

## Firestore layout

See `services/rag_chatbot_service.py` for the full layout. In short:

| Path | What it holds |
|---|---|
| `rag_projects/{pid}` | State and settings |
| `…/documents/{docId}` (+ `pages`) | Library references or uploaded text |
| `…/indexes/{indexId}/chunks/{0001}` | Each chunk's text, document, pages, paragraph numbers, context, and its embedding as float32 bytes |
| `…/asks/{id}` | Each question, with the passages used, the prompt sent, the answer, citations, the automatic check and the learner's verdict |
| `…/evals/{id}` | Each test run |
| `rag_embeddings/{sha1}` | Shared vectors for library chunks only. Uploads are never cached outside their project |

Deleting the project, or its guest session, removes everything under `rag_projects/{pid}`.
