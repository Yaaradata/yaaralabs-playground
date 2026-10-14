# Exercise 2 to Exercise 3

Each department file was trained twice, once with TF-IDF and once with embeddings.
The trainer used 20 real notes from each class in that CSV, held out 30 percent, and passed those class probabilities into Exercise 3.
Quiz percents, the right metric, and the stars are calculated from that held-out test. A typed answer of 250 was rejected, then the calculated percent was accepted.
The locked threshold in each round is the first point on the curve that meets the goal. It proves a miss is refused and a hit is accepted. It is not a recommended setting.

Pairs run: 20. Failures: 0.

## Summary

| Department | Method | Focus | Test notes | Precision | Recall | Lazy accuracy | Round 1 | Round 2 | Points |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Civil Engineering | tfidf | Unsafe | 6+6 | 33.3 | 16.7 | 50.0 | recall @ 0.01 (1★) | precision @ 0.46 (3★) | 3+4=7 |
| Civil Engineering | embeddings | Unsafe | 6+6 | 33.3 | 16.7 | 50.0 | recall @ 0.01 (1★) | precision @ 0.49 (3★) | 3+4=7 |
| Mechanical Engineering | tfidf | Fault | 6+6 | 66.7 | 66.7 | 50.0 | precision @ 0.54 (3★) | recall @ 0.01 (1★) | 5+2=7 |
| Mechanical Engineering | embeddings | Fault | 6+6 | 57.1 | 66.7 | 50.0 | precision @ 0.52 (3★) | recall @ 0.01 (3★) | 5+4=9 |
| Electrical Engineering | tfidf | Fault | 6+6 | 55.6 | 83.3 | 50.0 | recall @ 0.01 (3★) | precision @ 0.54 (3★) | 4+5=9 |
| Electrical Engineering | embeddings | Fault | 6+6 | 60.0 | 100.0 | 50.0 | recall @ 0.01 (1★) | precision @ 0.53 (3★) | 2+5=7 |
| Electronics and Communication | tfidf | Fail | 6+6 | 66.7 | 33.3 | 50.0 | precision @ 0.54 (3★) | recall @ 0.01 (3★) | 4+5=9 |
| Electronics and Communication | embeddings | Fail | 6+6 | 66.7 | 33.3 | 50.0 | precision @ 0.50 (3★) | recall @ 0.01 (2★) | 4+4=8 |
| Computer Science | tfidf | Bug | 6+6 | 25.0 | 16.7 | 50.0 | recall @ 0.01 (2★) | precision @ 0.40 (3★) | 3+4=7 |
| Computer Science | embeddings | Bug | 6+6 | 33.3 | 33.3 | 50.0 | recall @ 0.01 (3★) | precision @ 0.01 (3★) | 4+4=8 |
| Information Technology | tfidf | System Fault | 6+6 | 40.0 | 33.3 | 50.0 | precision @ 0.01 (3★) | recall @ 0.01 (3★) | 5+4=9 |
| Information Technology | embeddings | System Fault | 6+6 | 28.6 | 33.3 | 50.0 | precision @ 0.01 (3★) | recall @ 0.01 (3★) | 5+4=9 |
| Chemical Engineering | tfidf | Abnormal | 6+6 | 60.0 | 50.0 | 50.0 | recall @ 0.01 (2★) | precision @ 0.52 (3★) | 3+4=7 |
| Chemical Engineering | embeddings | Abnormal | 6+6 | 66.7 | 66.7 | 50.0 | recall @ 0.01 (1★) | precision @ 0.52 (3★) | 2+4=6 |
| Aerospace Engineering | tfidf | Unserviceable | 6+6 | 57.1 | 66.7 | 50.0 | precision @ 0.55 (3★) | recall @ 0.01 (1★) | 4+2=6 |
| Aerospace Engineering | embeddings | Unserviceable | 6+6 | 55.6 | 83.3 | 50.0 | precision @ 0.53 (3★) | recall @ 0.01 (2★) | 4+3=7 |
| Automobile Engineering | tfidf | Unsafe to Drive | 6+6 | 75.0 | 50.0 | 50.0 | recall @ 0.01 (3★) | precision @ 0.51 (3★) | 4+5=9 |
| Automobile Engineering | embeddings | Unsafe to Drive | 6+6 | 62.5 | 83.3 | 50.0 | recall @ 0.01 (3★) | precision @ 0.52 (3★) | 4+5=9 |
| Biomedical Engineering | tfidf | Device Fault | 6+6 | 40.0 | 33.3 | 50.0 | precision @ 0.57 (3★) | recall @ 0.01 (2★) | 4+3=7 |
| Biomedical Engineering | embeddings | Device Fault | 6+6 | 60.0 | 50.0 | 50.0 | precision @ 0.53 (3★) | recall @ 0.01 (3★) | 4+4=8 |


## Civil Engineering

Focus label: **Unsafe**. Classes: Safe, Unsafe.

Sample Unsafe note from the file: When it was checked the crack pushed over the acceptance criteria. the floor joist had shown efflorescence on the surface during the routine inspection by the pier.

### tfidf

Held-out notes passed to Exercise 3: 6 Unsafe, 6 other.
At threshold 0.50: caught 1, missed 5, false alarms 2, ignored 4.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Civil Engineering confusion matrix, in the Unsafe column, what share of the notes predicted Unsafe really are Unsafe? | rejected | 33.3% | Precision = TP ÷ (TP + FP) = 1 ÷ 3 = 33.3% |
| On this Civil Engineering confusion matrix, in the Unsafe row, what share of the real Unsafe notes did the model catch? | rejected | 16.7% | Recall = TP ÷ (TP + FN) = 1 ÷ 6 = 16.7% |
| On these Civil Engineering notes, count every note that is not Unsafe as correct and every real Unsafe note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Unsafe notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Hold an unsafe structure before it is used** (Site engineer, structural inspection). Needs **recall** at 95.0%.

Every note the model tags Unsafe is held for a structural check before that beam, column, foundation, or bridge stays in service.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.44 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 1 stars.

**Round 2 — Automatic closure of the structure** (Site manager). Needs **precision** at 71.0%.

A note tagged Unsafe now automatically closes the structure to traffic or work until the inspection is signed off.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.46 at precision 71.4%, recall 83.3%, 3 stars.

### embeddings

Held-out notes passed to Exercise 3: 6 Unsafe, 6 other.
At threshold 0.50: caught 1, missed 5, false alarms 2, ignored 4.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Civil Engineering confusion matrix, in the Unsafe column, what share of the notes predicted Unsafe really are Unsafe? | rejected | 33.3% | Precision = TP ÷ (TP + FP) = 1 ÷ 3 = 33.3% |
| On this Civil Engineering confusion matrix, in the Unsafe row, what share of the real Unsafe notes did the model catch? | rejected | 16.7% | Recall = TP ÷ (TP + FN) = 1 ÷ 6 = 16.7% |
| On these Civil Engineering notes, count every note that is not Unsafe as correct and every real Unsafe note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Unsafe notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Hold an unsafe structure before it is used** (Site engineer, structural inspection). Needs **recall** at 95.0%.

Every note the model tags Unsafe is held for a structural check before that beam, column, foundation, or bridge stays in service.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.49 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 1 stars.

**Round 2 — Automatic closure of the structure** (Site manager). Needs **precision** at 62.0%.

A note tagged Unsafe now automatically closes the structure to traffic or work until the inspection is signed off.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.49 at precision 62.5%, recall 83.3%, 3 stars.


## Mechanical Engineering

Focus label: **Fault**. Classes: Fault, Normal.

Sample Fault note from the file: After the oil change the hydraulic pump developed a slight hum; initially it seemed that the reading dropped below the acceptance band, and the same was found on inspection. a note was added to the history.

### tfidf

Held-out notes passed to Exercise 3: 6 Fault, 6 other.
At threshold 0.50: caught 4, missed 2, false alarms 2, ignored 4.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Mechanical Engineering confusion matrix, in the Fault column, what share of the notes predicted Fault really are Fault? | rejected | 66.7% | Precision = TP ÷ (TP + FP) = 4 ÷ 6 = 66.7% |
| On this Mechanical Engineering confusion matrix, in the Fault row, what share of the real Fault notes did the model catch? | rejected | 66.7% | Recall = TP ÷ (TP + FN) = 4 ÷ 6 = 66.7% |
| On these Mechanical Engineering notes, count every note that is not Fault as correct and every real Fault note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Fault notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Automatic line stop** (Production supervisor). Needs **precision** at 95.0%.

A note tagged Fault now automatically stops that machine and holds the line until maintenance clears it.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.54 at precision 100.0%, recall 16.7%, 3 stars.

**Round 2 — Stop a faulty machine before the next shift** (Maintenance lead, rotating equipment). Needs **recall** at 95.0%.

Notes tagged Fault go to the lead, who checks the pump, gearbox, motor, or bearing before the next shift starts.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.47 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 1 stars.

### embeddings

Held-out notes passed to Exercise 3: 6 Fault, 6 other.
At threshold 0.50: caught 4, missed 2, false alarms 3, ignored 3.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Mechanical Engineering confusion matrix, in the Fault column, what share of the notes predicted Fault really are Fault? | rejected | 57.1% | Precision = TP ÷ (TP + FP) = 4 ÷ 7 = 57.1% |
| On this Mechanical Engineering confusion matrix, in the Fault row, what share of the real Fault notes did the model catch? | rejected | 66.7% | Recall = TP ÷ (TP + FN) = 4 ÷ 6 = 66.7% |
| On these Mechanical Engineering notes, count every note that is not Fault as correct and every real Fault note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Fault notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Automatic line stop** (Production supervisor). Needs **precision** at 95.0%.

A note tagged Fault now automatically stops that machine and holds the line until maintenance clears it.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.52 at precision 100.0%, recall 33.3%, 3 stars.

**Round 2 — Stop a faulty machine before the next shift** (Maintenance lead, rotating equipment). Needs **recall** at 95.0%.

Notes tagged Fault go to the lead, who checks the pump, gearbox, motor, or bearing before the next shift starts.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.48 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 3 stars.


## Electrical Engineering

Focus label: **Fault**. Classes: Fault, Normal.

Sample Fault note from the file: There was a hum from the panel on the rectifier in the transformer bay after the recent trip; the first impression was that the tap reading stayed under the rated value, and it was confirmed on the follow-up.

### tfidf

Held-out notes passed to Exercise 3: 6 Fault, 6 other.
At threshold 0.50: caught 5, missed 1, false alarms 4, ignored 2.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Electrical Engineering confusion matrix, in the Fault column, what share of the notes predicted Fault really are Fault? | rejected | 55.6% | Precision = TP ÷ (TP + FP) = 5 ÷ 9 = 55.6% |
| On this Electrical Engineering confusion matrix, in the Fault row, what share of the real Fault notes did the model catch? | rejected | 83.3% | Recall = TP ÷ (TP + FN) = 5 ÷ 6 = 83.3% |
| On these Electrical Engineering notes, count every note that is not Fault as correct and every real Fault note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Fault notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Crew review before peak load** (Shift electrician, substation). Needs **recall** at 95.0%.

Notes tagged Fault go to the shift electrician, who checks the breaker, relay, or panel before the next peak.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.48 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 3 stars.

**Round 2 — Automatic feeder trip** (Grid control room). Needs **precision** at 80.0%.

A note tagged Fault now automatically trips that feeder until a crew confirms the finding.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.54 at precision 80.0%, recall 66.7%, 3 stars.

### embeddings

Held-out notes passed to Exercise 3: 6 Fault, 6 other.
At threshold 0.50: caught 6, missed 0, false alarms 4, ignored 2.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Electrical Engineering confusion matrix, in the Fault column, what share of the notes predicted Fault really are Fault? | rejected | 60.0% | Precision = TP ÷ (TP + FP) = 6 ÷ 10 = 60.0% |
| On this Electrical Engineering confusion matrix, in the Fault row, what share of the real Fault notes did the model catch? | rejected | 100.0% | Recall = TP ÷ (TP + FN) = 6 ÷ 6 = 100.0% |
| On these Electrical Engineering notes, count every note that is not Fault as correct and every real Fault note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Fault notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Crew review before peak load** (Shift electrician, substation). Needs **recall** at 95.0%.

Notes tagged Fault go to the shift electrician, who checks the breaker, relay, or panel before the next peak.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.51 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 1 stars.

**Round 2 — Automatic feeder trip** (Grid control room). Needs **precision** at 95.0%.

A note tagged Fault now automatically trips that feeder until a crew confirms the finding.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.53 at precision 100.0%, recall 16.7%, 3 stars.


## Electronics and Communication

Focus label: **Fail**. Classes: Fail, Pass.

Sample Fail note from the file: Initially it seemed that the rail voltage held within the expected level, while on inspection the timing margin came back above the acceptance band, on the solder joint at temperature. the ticket was updated.

### tfidf

Held-out notes passed to Exercise 3: 6 Fail, 6 other.
At threshold 0.50: caught 2, missed 4, false alarms 1, ignored 5.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Electronics and Communication confusion matrix, in the Fail column, what share of the notes predicted Fail really are Fail? | rejected | 66.7% | Precision = TP ÷ (TP + FP) = 2 ÷ 3 = 66.7% |
| On this Electronics and Communication confusion matrix, in the Fail row, what share of the real Fail notes did the model catch? | rejected | 33.3% | Recall = TP ÷ (TP + FN) = 2 ÷ 6 = 33.3% |
| On these Electronics and Communication notes, count every note that is not Fail as correct and every real Fail note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Fail notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Automatic technician dispatch** (Field operations). Needs **precision** at 95.0%.

Every ticket tagged Fail now sends a technician out to the field unit or the test jig.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.54 at precision 100.0%, recall 16.7%, 3 stars.

**Round 2 — Hold a board that missed spec** (Hardware engineer, board bring-up). Needs **recall** at 95.0%.

Tickets tagged Fail go to a bench engineer, who checks the board, connector, or GPS receiver before the device ships.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.43 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 3 stars.

### embeddings

Held-out notes passed to Exercise 3: 6 Fail, 6 other.
At threshold 0.50: caught 2, missed 4, false alarms 1, ignored 5.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Electronics and Communication confusion matrix, in the Fail column, what share of the notes predicted Fail really are Fail? | rejected | 66.7% | Precision = TP ÷ (TP + FP) = 2 ÷ 3 = 66.7% |
| On this Electronics and Communication confusion matrix, in the Fail row, what share of the real Fail notes did the model catch? | rejected | 33.3% | Recall = TP ÷ (TP + FN) = 2 ÷ 6 = 33.3% |
| On these Electronics and Communication notes, count every note that is not Fail as correct and every real Fail note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Fail notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Automatic technician dispatch** (Field operations). Needs **precision** at 66.0%.

Every ticket tagged Fail now sends a technician out to the field unit or the test jig.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.50 at precision 66.7%, recall 33.3%, 3 stars.

**Round 2 — Hold a board that missed spec** (Hardware engineer, board bring-up). Needs **recall** at 95.0%.

Tickets tagged Fail go to a bench engineer, who checks the board, connector, or GPS receiver before the device ships.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.46 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 2 stars.


## Computer Science

Focus label: **Bug**. Classes: Bug, Working as Intended.

Sample Bug note from the file: A field note records a stale value after refresh on the data importer on the login flow in the latest build; on inspection the returned status broke from the documented spec. the reading was recorded.

### tfidf

Held-out notes passed to Exercise 3: 6 Bug, 6 other.
At threshold 0.50: caught 1, missed 5, false alarms 3, ignored 3.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Computer Science confusion matrix, in the Bug column, what share of the notes predicted Bug really are Bug? | rejected | 25.0% | Precision = TP ÷ (TP + FP) = 1 ÷ 4 = 25.0% |
| On this Computer Science confusion matrix, in the Bug row, what share of the real Bug notes did the model catch? | rejected | 16.7% | Recall = TP ÷ (TP + FN) = 1 ÷ 6 = 16.7% |
| On these Computer Science notes, count every note that is not Bug as correct and every real Bug note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Bug notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Triage a live defect before it ships** (On-call engineer, product engineering). Needs **recall** at 95.0%.

Tickets tagged Bug go to the on-call board within a day, ahead of Working as Intended notes.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.42 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 2 stars.

**Round 2 — Automatic service rollback** (On-call administrator). Needs **precision** at 54.0%.

A ticket tagged Bug now rolls that service back until the report is confirmed.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.40 at precision 54.5%, recall 100.0%, 3 stars.

### embeddings

Held-out notes passed to Exercise 3: 6 Bug, 6 other.
At threshold 0.50: caught 2, missed 4, false alarms 4, ignored 2.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Computer Science confusion matrix, in the Bug column, what share of the notes predicted Bug really are Bug? | rejected | 33.3% | Precision = TP ÷ (TP + FP) = 2 ÷ 6 = 33.3% |
| On this Computer Science confusion matrix, in the Bug row, what share of the real Bug notes did the model catch? | rejected | 33.3% | Recall = TP ÷ (TP + FN) = 2 ÷ 6 = 33.3% |
| On these Computer Science notes, count every note that is not Bug as correct and every real Bug note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Bug notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Triage a live defect before it ships** (On-call engineer, product engineering). Needs **recall** at 95.0%.

Tickets tagged Bug go to the on-call board within a day, ahead of Working as Intended notes.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.46 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 3 stars.

**Round 2 — Automatic service rollback** (On-call administrator). Needs **precision** at 50.0%.

A ticket tagged Bug now rolls that service back until the report is confirmed.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.49 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 3 stars.


## Information Technology

Focus label: **System Fault**. Classes: System Fault, User Error.

Sample System Fault note from the file: Maintenance picked up a mailbox that is full on the user account on the VPN after the reimage; once re-tested the cause came down to a failure in the mailbox. the reading was recorded.

### tfidf

Held-out notes passed to Exercise 3: 6 System Fault, 6 other.
At threshold 0.50: caught 2, missed 4, false alarms 3, ignored 3.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Information Technology confusion matrix, in the System Fault column, what share of the notes predicted System Fault really are System Fault? | rejected | 40.0% | Precision = TP ÷ (TP + FP) = 2 ÷ 5 = 40.0% |
| On this Information Technology confusion matrix, in the System Fault row, what share of the real System Fault notes did the model catch? | rejected | 33.3% | Recall = TP ÷ (TP + FN) = 2 ÷ 6 = 33.3% |
| On these Information Technology notes, count every note that is not System Fault as correct and every real System Fault note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-System Fault notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Automatic service disable** (Campus infrastructure lead). Needs **precision** at 50.0%.

A ticket tagged System Fault now takes that service offline until someone confirms it.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.41 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 3 stars.

**Round 2 — Fix the kit before the next class** (IT service desk). Needs **recall** at 95.0%.

Tickets tagged System Fault go to the kit desk, who can restore wifi, printers, or laptops before the next session.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.41 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 3 stars.

### embeddings

Held-out notes passed to Exercise 3: 6 System Fault, 6 other.
At threshold 0.50: caught 2, missed 4, false alarms 5, ignored 1.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Information Technology confusion matrix, in the System Fault column, what share of the notes predicted System Fault really are System Fault? | rejected | 28.6% | Precision = TP ÷ (TP + FP) = 2 ÷ 7 = 28.6% |
| On this Information Technology confusion matrix, in the System Fault row, what share of the real System Fault notes did the model catch? | rejected | 33.3% | Recall = TP ÷ (TP + FN) = 2 ÷ 6 = 33.3% |
| On these Information Technology notes, count every note that is not System Fault as correct and every real System Fault note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-System Fault notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Automatic service disable** (Campus infrastructure lead). Needs **precision** at 50.0%.

A ticket tagged System Fault now takes that service offline until someone confirms it.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.44 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 3 stars.

**Round 2 — Fix the kit before the next class** (IT service desk). Needs **recall** at 95.0%.

Tickets tagged System Fault go to the kit desk, who can restore wifi, printers, or laptops before the next session.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.44 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 3 stars.


## Chemical Engineering

Focus label: **Abnormal**. Classes: Abnormal, Normal.

Sample Abnormal note from the file: The shift log records a small weep at the flange and a foaming tendency on the pipeline over the last few hours; after investigation the concentration crept past the limit. the trend will be watched.

### tfidf

Held-out notes passed to Exercise 3: 6 Abnormal, 6 other.
At threshold 0.50: caught 3, missed 3, false alarms 2, ignored 4.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Chemical Engineering confusion matrix, in the Abnormal column, what share of the notes predicted Abnormal really are Abnormal? | rejected | 60.0% | Precision = TP ÷ (TP + FP) = 3 ÷ 5 = 60.0% |
| On this Chemical Engineering confusion matrix, in the Abnormal row, what share of the real Abnormal notes did the model catch? | rejected | 50.0% | Recall = TP ÷ (TP + FN) = 3 ÷ 6 = 50.0% |
| On these Chemical Engineering notes, count every note that is not Abnormal as correct and every real Abnormal note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Abnormal notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Safety-officer check on the unit** (Plant safety officer). Needs **recall** at 95.0%.

Logs tagged Abnormal go straight to the safety officer, ahead of Normal runs.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.44 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 2 stars.

**Round 2 — Automatic emergency shutdown** (Process control room). Needs **precision** at 95.0%.

A log tagged Abnormal now trips the emergency shutdown on that unit.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.52 at precision 100.0%, recall 50.0%, 3 stars.

### embeddings

Held-out notes passed to Exercise 3: 6 Abnormal, 6 other.
At threshold 0.50: caught 4, missed 2, false alarms 2, ignored 4.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Chemical Engineering confusion matrix, in the Abnormal column, what share of the notes predicted Abnormal really are Abnormal? | rejected | 66.7% | Precision = TP ÷ (TP + FP) = 4 ÷ 6 = 66.7% |
| On this Chemical Engineering confusion matrix, in the Abnormal row, what share of the real Abnormal notes did the model catch? | rejected | 66.7% | Recall = TP ÷ (TP + FN) = 4 ÷ 6 = 66.7% |
| On these Chemical Engineering notes, count every note that is not Abnormal as correct and every real Abnormal note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Abnormal notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Safety-officer check on the unit** (Plant safety officer). Needs **recall** at 95.0%.

Logs tagged Abnormal go straight to the safety officer, ahead of Normal runs.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.50 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 1 stars.

**Round 2 — Automatic emergency shutdown** (Process control room). Needs **precision** at 95.0%.

A log tagged Abnormal now trips the emergency shutdown on that unit.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.52 at precision 100.0%, recall 33.3%, 3 stars.


## Aerospace Engineering

Focus label: **Unserviceable**. Classes: Serviceable, Unserviceable.

Sample Unserviceable note from the file: There was a chafe mark on the loom on the air data computer in the avionics bay during turnaround; from the desk it looked like the wear came back under the tolerance, and it was confirmed on the follow-up. it was flagged for the planner.

### tfidf

Held-out notes passed to Exercise 3: 6 Unserviceable, 6 other.
At threshold 0.50: caught 4, missed 2, false alarms 3, ignored 3.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Aerospace Engineering confusion matrix, in the Unserviceable column, what share of the notes predicted Unserviceable really are Unserviceable? | rejected | 57.1% | Precision = TP ÷ (TP + FP) = 4 ÷ 7 = 57.1% |
| On this Aerospace Engineering confusion matrix, in the Unserviceable row, what share of the real Unserviceable notes did the model catch? | rejected | 66.7% | Recall = TP ÷ (TP + FN) = 4 ÷ 6 = 66.7% |
| On these Aerospace Engineering notes, count every note that is not Unserviceable as correct and every real Unserviceable note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Unserviceable notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Automatic grounding** (Airline operations control). Needs **precision** at 66.0%.

A note tagged Unserviceable now grounds the aircraft and cancels the next flight.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.55 at precision 66.7%, recall 33.3%, 3 stars.

**Round 2 — Sign-off before the next flight** (Chief maintenance engineer, hangar). Needs **recall** at 95.0%.

Notes tagged Unserviceable must be signed off before release. Serviceable notes follow the normal bay.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.49 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 1 stars.

### embeddings

Held-out notes passed to Exercise 3: 6 Unserviceable, 6 other.
At threshold 0.50: caught 5, missed 1, false alarms 4, ignored 2.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Aerospace Engineering confusion matrix, in the Unserviceable column, what share of the notes predicted Unserviceable really are Unserviceable? | rejected | 55.6% | Precision = TP ÷ (TP + FP) = 5 ÷ 9 = 55.6% |
| On this Aerospace Engineering confusion matrix, in the Unserviceable row, what share of the real Unserviceable notes did the model catch? | rejected | 83.3% | Recall = TP ÷ (TP + FN) = 5 ÷ 6 = 83.3% |
| On these Aerospace Engineering notes, count every note that is not Unserviceable as correct and every real Unserviceable note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Unserviceable notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Automatic grounding** (Airline operations control). Needs **precision** at 95.0%.

A note tagged Unserviceable now grounds the aircraft and cancels the next flight.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.53 at precision 100.0%, recall 16.7%, 3 stars.

**Round 2 — Sign-off before the next flight** (Chief maintenance engineer, hangar). Needs **recall** at 95.0%.

Notes tagged Unserviceable must be signed off before release. Serviceable notes follow the normal bay.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.50 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 2 stars.


## Automobile Engineering

Focus label: **Unsafe to Drive**. Classes: Safe to Drive, Unsafe to Drive.

Sample Unsafe to Drive note from the file: The crew logged a knock over bumps on the CV joint in the engine bay when turning; on closer examination the noise climbed above the spec. the trend will be watched.

### tfidf

Held-out notes passed to Exercise 3: 6 Unsafe to Drive, 6 other.
At threshold 0.50: caught 3, missed 3, false alarms 1, ignored 5.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Automobile Engineering confusion matrix, in the Unsafe to Drive column, what share of the notes predicted Unsafe to Drive really are Unsafe to Drive? | rejected | 75.0% | Precision = TP ÷ (TP + FP) = 3 ÷ 4 = 75.0% |
| On this Automobile Engineering confusion matrix, in the Unsafe to Drive row, what share of the real Unsafe to Drive notes did the model catch? | rejected | 50.0% | Recall = TP ÷ (TP + FN) = 3 ÷ 6 = 50.0% |
| On these Automobile Engineering notes, count every note that is not Unsafe to Drive as correct and every real Unsafe to Drive note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Unsafe to Drive notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Hold the car before handover** (Floor manager, service centre). Needs **recall** at 95.0%.

Job-card notes tagged Unsafe to Drive get a bay test before handover. Safe to Drive cars leave on the normal path.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.45 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 3 stars.

**Round 2 — Automatic hold under warranty** (Warranty claims desk). Needs **precision** at 95.0%.

A note tagged Unsafe to Drive now holds the car and opens a warranty job until it is cleared.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.51 at precision 100.0%, recall 33.3%, 3 stars.

### embeddings

Held-out notes passed to Exercise 3: 6 Unsafe to Drive, 6 other.
At threshold 0.50: caught 5, missed 1, false alarms 3, ignored 3.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Automobile Engineering confusion matrix, in the Unsafe to Drive column, what share of the notes predicted Unsafe to Drive really are Unsafe to Drive? | rejected | 62.5% | Precision = TP ÷ (TP + FP) = 5 ÷ 8 = 62.5% |
| On this Automobile Engineering confusion matrix, in the Unsafe to Drive row, what share of the real Unsafe to Drive notes did the model catch? | rejected | 83.3% | Recall = TP ÷ (TP + FN) = 5 ÷ 6 = 83.3% |
| On these Automobile Engineering notes, count every note that is not Unsafe to Drive as correct and every real Unsafe to Drive note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Unsafe to Drive notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Hold the car before handover** (Floor manager, service centre). Needs **recall** at 95.0%.

Job-card notes tagged Unsafe to Drive get a bay test before handover. Safe to Drive cars leave on the normal path.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.48 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 3 stars.

**Round 2 — Automatic hold under warranty** (Warranty claims desk). Needs **precision** at 95.0%.

A note tagged Unsafe to Drive now holds the car and opens a warranty job until it is cleared.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.52 at precision 100.0%, recall 33.3%, 3 stars.


## Biomedical Engineering

Focus label: **Device Fault**. Classes: Device Fault, No Fault Found.

Sample Device Fault note from the file: On the follow-up check the flow rate pushed over the expected value. the anesthesia machine had shown a calibration prompt during the safety test in the ICU. the reading was recorded.

### tfidf

Held-out notes passed to Exercise 3: 6 Device Fault, 6 other.
At threshold 0.50: caught 2, missed 4, false alarms 3, ignored 3.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Biomedical Engineering confusion matrix, in the Device Fault column, what share of the notes predicted Device Fault really are Device Fault? | rejected | 40.0% | Precision = TP ÷ (TP + FP) = 2 ÷ 5 = 40.0% |
| On this Biomedical Engineering confusion matrix, in the Device Fault row, what share of the real Device Fault notes did the model catch? | rejected | 33.3% | Recall = TP ÷ (TP + FN) = 2 ÷ 6 = 33.3% |
| On these Biomedical Engineering notes, count every note that is not Device Fault as correct and every real Device Fault note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Device Fault notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Automatic device lockout** (Equipment manager). Needs **precision** at 95.0%.

A note tagged Device Fault now locks the device out of clinical use until the vendor re-certifies it.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.57 at precision 100.0%, recall 33.3%, 3 stars.

**Round 2 — Pull a failed device before the next patient** (Clinical engineer, hospital). Needs **recall** at 95.0%.

Notes tagged Device Fault are inspected before that pump, monitor, or ventilator is used again. No Fault Found notes follow the normal bench.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.46 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 2 stars.

### embeddings

Held-out notes passed to Exercise 3: 6 Device Fault, 6 other.
At threshold 0.50: caught 3, missed 3, false alarms 2, ignored 4.

| Question | Wrong 250 | Calculated answer | Formula |
| --- | --- | --- | --- |
| On this Biomedical Engineering confusion matrix, in the Device Fault column, what share of the notes predicted Device Fault really are Device Fault? | rejected | 60.0% | Precision = TP ÷ (TP + FP) = 3 ÷ 5 = 60.0% |
| On this Biomedical Engineering confusion matrix, in the Device Fault row, what share of the real Device Fault notes did the model catch? | rejected | 50.0% | Recall = TP ÷ (TP + FN) = 3 ÷ 6 = 50.0% |
| On these Biomedical Engineering notes, count every note that is not Device Fault as correct and every real Device Fault note as wrong. What accuracy is that on these 12 notes? | rejected | 50.0% | Lazy score = non-Device Fault notes ÷ all = 6 ÷ 12 = 50.0% |

**Round 1 — Automatic device lockout** (Equipment manager). Needs **precision** at 95.0%.

A note tagged Device Fault now locks the device out of clinical use until the vendor re-certifies it.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.01 rejected) was refused. Locked 0.53 at precision 100.0%, recall 16.7%, 3 stars.

**Round 2 — Pull a failed device before the next patient** (Clinical engineer, hospital). Needs **recall** at 95.0%.

Notes tagged Device Fault are inspected before that pump, monitor, or ventilator is used again. No Fault Found notes follow the normal bench.

Wrong metric rejected. Exactly one reason accepted. A miss threshold (0.48 rejected) was refused. Locked 0.01 at precision 50.0%, recall 100.0%, 3 stars.

