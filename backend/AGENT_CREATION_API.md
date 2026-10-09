# Agent Creation API

Perfect — thanks for pasting the **full granular flow**.
Below is a **very clear, phase-by-phase mapping** of:

1. **Exact GCP setup you need** (only what is required for *this* flow)
2. **Exact APIs you must build**, mapped **directly to each phase and step you described**
3. **Which GCP service is used at each step**

No abstractions, no "platform talk", no extras.

---

# PART 1 — GCP SETUP (STRICTLY FOR THIS IDEA)

You already have a GCP project.
Below is what you must **configure and why**, mapped to your phases.

---

## 1. Cloud Run (Backend Runtime)

**Why you need it**

* Hosts all APIs:

  * `/agent/create`
  * `/kb/*`
  * `/rules/*`
  * `/chat`
  * `/chat/teach`

**Setup**

* One Cloud Run service
* Runtime: Python (FastAPI) or Node.js
* Memory: **2–4 GB** (embeddings + file parsing)
* Service account with access to:

  * Firestore
  * Cloud Storage
  * Vertex AI

---

## 2. Firestore (Only Database)

**Why**

* Persistent storage for:

  * Agents
  * Personas
  * Knowledge Base
  * Rules
  * Chat traces

**Mode**

* Firestore **Native mode**

**Collections (must exist logically)**

```
agents
personas
knowledge
rules
chat_logs
```

You do **not** need schema migration — Firestore is schema-less.

---

## 3. Vertex AI

You will use Vertex AI in **four places only**.

### 3.1 Text Generation

Used for:

* Agent specification generation (JSON)
* Chat responses
* Intent detection
* Sentiment detection

### 3.2 Embeddings

Used for:

* KB (TEXT / FILE / LINK / QNA)
* User chat messages

**Important**

* Same embedding model everywhere
* Same region as Cloud Run

---

## 4. Cloud Storage

**Why**

* File KB uploads
* Temporary storage for fetched website content

**Setup**

* One bucket (example):

```
gs://agent-kb-files
```

**Access**

* Cloud Run service account → read/write

---

## 5. Scheduler (for Cleanup)

**Why**

* Phase 7 cleanup (delete agents older than N days)

**Setup**

* Cloud Scheduler
* Calls an internal cleanup API on Cloud Run

---

# PART 2 — APIs YOU NEED (MAPPED TO YOUR PHASES)

Below, every API is tied **directly** to the steps you described.

---

## PHASE 1 — AGENT CREATION

### API 1: Create Agent from Prompt

**Endpoint**

```
POST /agent/create
```

**Used in**

* Phase 1, Step 1 & 2

**What it does**

1. Accepts free-text prompt
2. Calls Vertex AI (text generation)
3. Forces LLM to return JSON:

   * name
   * role
   * tone
   * language
4. Stores agent + persona

**Input**

```json
{
  "user_id": "u123",
  "session_id": "s456",
  "agent_description": "Create an application assistant..."
}
```

**Writes to Firestore**

* `agents/{agentId}`
* `personas/{agentId}`

---

## PHASE 2 — KNOWLEDGE BASE

### API 2: Add Text Knowledge

```
POST /kb/text
```

**Used in**

* Phase 2 → 4.1

**Processing**

* Generate embedding (Vertex AI)
* Store in Firestore

---

### API 3: Upload File Knowledge

```
POST /kb/file
```

**Used in**

* Phase 2 → 4.2

**Processing**

1. Upload file → Cloud Storage
2. Extract text
3. Chunk
4. Embed each chunk
5. Store each chunk as a KB record

---

### API 4: Add Link Knowledge

```
POST /kb/link
```

**Used in**

* Phase 2 → 4.3

**Processing**

1. Fetch URL once
2. Clean HTML
3. Chunk text
4. Embed
5. Store KB entries

---

### API 5: Add Q&A Knowledge

```
POST /kb/qna
```

**Used in**

* Phase 2 → 4.4

**Processing**

* Combine Q + A
* Embed
* Store with high priority flag

---

## PHASE 3 — ACTIONS (RULES)

### API 6: Create / Update Rule

```
POST /rules/save
```

**Used in**

* Phase 3 → Step 6

**Processing**

* Validate WHEN condition
* Validate DO action
* Store rule as deterministic config

**Writes**

* `rules/{ruleId}`

---

### API 7: List Rules (UI Load)

```
GET /rules?agentId=...
```

Used to reload rule configuration in UI.

---

## PHASE 4 — RUNTIME CHAT

### API 8: Chat with Agent (CORE)

```
POST /chat
```

**Used in**

* Phase 4 → Steps 7–13

**Processing pipeline**

1. Load agent + persona + rules
2. Detect conditions:

   * keyword
   * intent (Vertex AI)
   * sentiment (Vertex AI)
3. Evaluate rules
4. If rule matched:

   * Execute DO action
   * Possibly skip LLM
5. Else:

   * Embed message
   * Retrieve KB
   * Build prompt
   * Call Vertex AI
6. Log full trace

**Writes**

* `chat_logs/{id}`

---

## PHASE 5 — TRACE & EXPLAINABILITY

(No separate API — part of `/chat`)

**Stored automatically**

* Conditions detected
* Rule matched
* KB used
* LLM used or skipped
* Final response

---

## PHASE 6 — TEACH-BY-CHAT

### API 9: Teach Agent from Chat

```
POST /chat/teach
```

**Used in**

* Phase 6 → Step 16

**Processing**

1. Take approved response
2. Convert into TEXT KB
3. Embed
4. Store

**Writes**

* `knowledge`

---

## PHASE 7 — CLEANUP

### API 10: Cleanup Old Agents

```
POST /internal/cleanup
```

**Called by**

* Cloud Scheduler

**Processing**

* Delete agents older than N days
* Cascade delete:

  * persona
  * knowledge
  * rules
  * chat_logs

---

# PART 3 — INTERNAL LOGIC (NOT APIs, BUT REQUIRED)

These are **mandatory internal modules**:

1. **LLM JSON validator**

   * Ensures agent creation response is valid JSON

2. **Rule Engine**

   * Deterministic
   * Priority-based
   * Single-action execution

3. **KB Retrieval Engine**

   * Embedding similarity
   * Q&A boosted ranking

4. **Trace Builder**

   * Builds `chat_logs` record every time

---

# FINAL ONE-PAGE SUMMARY

### GCP Services Used

* Cloud Run
* Firestore
* Vertex AI
* Cloud Storage
* Cloud Scheduler

### APIs You Must Build

1. `/agent/create`
2. `/persona/save`
3. `/kb/text`
4. `/kb/file`
5. `/kb/link`
6. `/kb/qna`
7. `/rules/save`
8. `/chat`
9. `/chat/teach`
10. `/internal/cleanup`

### Guarantee

Every step in your document maps to:

* One API
* One GCP service
* One deterministic behavior


