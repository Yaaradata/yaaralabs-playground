# Exercise 2 held-out metrics for every label

Each department file was trained with TF-IDF and with embeddings.
Precision, recall, and F1 are one-vs-rest on that label. Model accuracy is the one-vs-rest accuracy of the same cells.
Overall accuracy is the multiclass score from Exercise 2.

Labels checked: 40. Failures: 0.

| Department | Method | Label | Precision | Recall | F1 | One-vs-rest accuracy | Overall accuracy |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Civil Engineering | tfidf | Safe | 42.9 | 60.0 | 50.0 | 40.0 | 40.0 |
| Civil Engineering | tfidf | Unsafe | 33.3 | 20.0 | 25.0 | 40.0 | 40.0 |
| Civil Engineering | embeddings | Safe | 57.1 | 80.0 | 66.7 | 60.0 | 60.0 |
| Civil Engineering | embeddings | Unsafe | 66.7 | 40.0 | 50.0 | 60.0 | 60.0 |
| Mechanical Engineering | tfidf | Fault | 33.3 | 40.0 | 36.4 | 30.0 | 30.0 |
| Mechanical Engineering | tfidf | Normal | 25.0 | 20.0 | 22.2 | 30.0 | 30.0 |
| Mechanical Engineering | embeddings | Fault | 40.0 | 40.0 | 40.0 | 40.0 | 40.0 |
| Mechanical Engineering | embeddings | Normal | 40.0 | 40.0 | 40.0 | 40.0 | 40.0 |
| Electrical Engineering | tfidf | Fault | 50.0 | 40.0 | 44.4 | 50.0 | 50.0 |
| Electrical Engineering | tfidf | Normal | 50.0 | 60.0 | 54.5 | 50.0 | 50.0 |
| Electrical Engineering | embeddings | Fault | 75.0 | 60.0 | 66.7 | 70.0 | 70.0 |
| Electrical Engineering | embeddings | Normal | 66.7 | 80.0 | 72.7 | 70.0 | 70.0 |
| Electronics and Communication | tfidf | Fail | 75.0 | 60.0 | 66.7 | 70.0 | 70.0 |
| Electronics and Communication | tfidf | Pass | 66.7 | 80.0 | 72.7 | 70.0 | 70.0 |
| Electronics and Communication | embeddings | Fail | 57.1 | 80.0 | 66.7 | 60.0 | 60.0 |
| Electronics and Communication | embeddings | Pass | 66.7 | 40.0 | 50.0 | 60.0 | 60.0 |
| Computer Science | tfidf | Bug | 50.0 | 60.0 | 54.5 | 50.0 | 50.0 |
| Computer Science | tfidf | Working as Intended | 50.0 | 40.0 | 44.4 | 50.0 | 50.0 |
| Computer Science | embeddings | Bug | 25.0 | 20.0 | 22.2 | 30.0 | 30.0 |
| Computer Science | embeddings | Working as Intended | 33.3 | 40.0 | 36.4 | 30.0 | 30.0 |
| Information Technology | tfidf | System Fault | 33.3 | 40.0 | 36.4 | 30.0 | 30.0 |
| Information Technology | tfidf | User Error | 25.0 | 20.0 | 22.2 | 30.0 | 30.0 |
| Information Technology | embeddings | System Fault | 25.0 | 20.0 | 22.2 | 30.0 | 30.0 |
| Information Technology | embeddings | User Error | 33.3 | 40.0 | 36.4 | 30.0 | 30.0 |
| Chemical Engineering | tfidf | Abnormal | 44.4 | 80.0 | 57.1 | 40.0 | 40.0 |
| Chemical Engineering | tfidf | Normal | 0.0 | 0.0 | 0.0 | 40.0 | 40.0 |
| Chemical Engineering | embeddings | Abnormal | 44.4 | 80.0 | 57.1 | 40.0 | 40.0 |
| Chemical Engineering | embeddings | Normal | 0.0 | 0.0 | 0.0 | 40.0 | 40.0 |
| Aerospace Engineering | tfidf | Serviceable | 57.1 | 80.0 | 66.7 | 60.0 | 60.0 |
| Aerospace Engineering | tfidf | Unserviceable | 66.7 | 40.0 | 50.0 | 60.0 | 60.0 |
| Aerospace Engineering | embeddings | Serviceable | 50.0 | 80.0 | 61.5 | 50.0 | 50.0 |
| Aerospace Engineering | embeddings | Unserviceable | 50.0 | 20.0 | 28.6 | 50.0 | 50.0 |
| Automobile Engineering | tfidf | Safe to Drive | 33.3 | 20.0 | 25.0 | 40.0 | 40.0 |
| Automobile Engineering | tfidf | Unsafe to Drive | 42.9 | 60.0 | 50.0 | 40.0 | 40.0 |
| Automobile Engineering | embeddings | Safe to Drive | 25.0 | 20.0 | 22.2 | 30.0 | 30.0 |
| Automobile Engineering | embeddings | Unsafe to Drive | 33.3 | 40.0 | 36.4 | 30.0 | 30.0 |
| Biomedical Engineering | tfidf | Device Fault | 75.0 | 60.0 | 66.7 | 70.0 | 70.0 |
| Biomedical Engineering | tfidf | No Fault Found | 66.7 | 80.0 | 72.7 | 70.0 | 70.0 |
| Biomedical Engineering | embeddings | Device Fault | 60.0 | 60.0 | 60.0 | 60.0 | 60.0 |
| Biomedical Engineering | embeddings | No Fault Found | 60.0 | 60.0 | 60.0 | 60.0 | 60.0 |
