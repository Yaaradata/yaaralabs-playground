# Exercise 3 metric grid

Each department label was scored on 15 confusion-count shapes.
Precision, recall, F1, and accuracy are computed from those counts, then checked against Exercise 3.
The quiz accuracy is the lazy score (every non-focus note counted correct). Model accuracy is (TP + TN) / all.

Cases: 300. Failures: 0.

| Department | Label | Shape | TP | FP | FN | TN | Precision | Recall | F1 | Model accuracy | Lazy accuracy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Civil Engineering | Safe | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Civil Engineering | Safe | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Civil Engineering | Safe | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Civil Engineering | Safe | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Civil Engineering | Safe | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Civil Engineering | Safe | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Civil Engineering | Safe | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Civil Engineering | Safe | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Civil Engineering | Safe | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Civil Engineering | Safe | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Civil Engineering | Safe | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Civil Engineering | Safe | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Civil Engineering | Safe | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Civil Engineering | Safe | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Civil Engineering | Safe | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Civil Engineering | Unsafe | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Civil Engineering | Unsafe | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Civil Engineering | Unsafe | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Civil Engineering | Unsafe | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Civil Engineering | Unsafe | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Civil Engineering | Unsafe | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Civil Engineering | Unsafe | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Civil Engineering | Unsafe | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Civil Engineering | Unsafe | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Civil Engineering | Unsafe | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Civil Engineering | Unsafe | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Civil Engineering | Unsafe | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Civil Engineering | Unsafe | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Civil Engineering | Unsafe | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Civil Engineering | Unsafe | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Mechanical Engineering | Normal | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Mechanical Engineering | Normal | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Mechanical Engineering | Normal | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Mechanical Engineering | Normal | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Mechanical Engineering | Normal | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Mechanical Engineering | Normal | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Mechanical Engineering | Normal | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Mechanical Engineering | Normal | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Mechanical Engineering | Normal | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Mechanical Engineering | Normal | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Mechanical Engineering | Normal | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Mechanical Engineering | Normal | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Mechanical Engineering | Normal | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Mechanical Engineering | Normal | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Mechanical Engineering | Normal | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Mechanical Engineering | Fault | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Mechanical Engineering | Fault | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Mechanical Engineering | Fault | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Mechanical Engineering | Fault | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Mechanical Engineering | Fault | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Mechanical Engineering | Fault | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Mechanical Engineering | Fault | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Mechanical Engineering | Fault | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Mechanical Engineering | Fault | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Mechanical Engineering | Fault | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Mechanical Engineering | Fault | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Mechanical Engineering | Fault | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Mechanical Engineering | Fault | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Mechanical Engineering | Fault | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Mechanical Engineering | Fault | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Electrical Engineering | Normal | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Electrical Engineering | Normal | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Electrical Engineering | Normal | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Electrical Engineering | Normal | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Electrical Engineering | Normal | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Electrical Engineering | Normal | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Electrical Engineering | Normal | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Electrical Engineering | Normal | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Electrical Engineering | Normal | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Electrical Engineering | Normal | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Electrical Engineering | Normal | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Electrical Engineering | Normal | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Electrical Engineering | Normal | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Electrical Engineering | Normal | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Electrical Engineering | Normal | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Electrical Engineering | Fault | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Electrical Engineering | Fault | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Electrical Engineering | Fault | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Electrical Engineering | Fault | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Electrical Engineering | Fault | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Electrical Engineering | Fault | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Electrical Engineering | Fault | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Electrical Engineering | Fault | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Electrical Engineering | Fault | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Electrical Engineering | Fault | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Electrical Engineering | Fault | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Electrical Engineering | Fault | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Electrical Engineering | Fault | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Electrical Engineering | Fault | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Electrical Engineering | Fault | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Electronics and Communication | Pass | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Electronics and Communication | Pass | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Electronics and Communication | Pass | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Electronics and Communication | Pass | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Electronics and Communication | Pass | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Electronics and Communication | Pass | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Electronics and Communication | Pass | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Electronics and Communication | Pass | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Electronics and Communication | Pass | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Electronics and Communication | Pass | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Electronics and Communication | Pass | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Electronics and Communication | Pass | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Electronics and Communication | Pass | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Electronics and Communication | Pass | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Electronics and Communication | Pass | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Electronics and Communication | Fail | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Electronics and Communication | Fail | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Electronics and Communication | Fail | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Electronics and Communication | Fail | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Electronics and Communication | Fail | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Electronics and Communication | Fail | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Electronics and Communication | Fail | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Electronics and Communication | Fail | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Electronics and Communication | Fail | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Electronics and Communication | Fail | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Electronics and Communication | Fail | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Electronics and Communication | Fail | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Electronics and Communication | Fail | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Electronics and Communication | Fail | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Electronics and Communication | Fail | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Computer Science | Bug | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Computer Science | Bug | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Computer Science | Bug | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Computer Science | Bug | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Computer Science | Bug | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Computer Science | Bug | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Computer Science | Bug | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Computer Science | Bug | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Computer Science | Bug | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Computer Science | Bug | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Computer Science | Bug | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Computer Science | Bug | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Computer Science | Bug | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Computer Science | Bug | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Computer Science | Bug | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Computer Science | Working as Intended | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Computer Science | Working as Intended | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Computer Science | Working as Intended | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Computer Science | Working as Intended | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Computer Science | Working as Intended | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Computer Science | Working as Intended | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Computer Science | Working as Intended | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Computer Science | Working as Intended | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Computer Science | Working as Intended | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Computer Science | Working as Intended | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Computer Science | Working as Intended | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Computer Science | Working as Intended | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Computer Science | Working as Intended | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Computer Science | Working as Intended | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Computer Science | Working as Intended | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Information Technology | User Error | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Information Technology | User Error | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Information Technology | User Error | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Information Technology | User Error | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Information Technology | User Error | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Information Technology | User Error | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Information Technology | User Error | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Information Technology | User Error | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Information Technology | User Error | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Information Technology | User Error | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Information Technology | User Error | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Information Technology | User Error | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Information Technology | User Error | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Information Technology | User Error | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Information Technology | User Error | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Information Technology | System Fault | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Information Technology | System Fault | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Information Technology | System Fault | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Information Technology | System Fault | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Information Technology | System Fault | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Information Technology | System Fault | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Information Technology | System Fault | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Information Technology | System Fault | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Information Technology | System Fault | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Information Technology | System Fault | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Information Technology | System Fault | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Information Technology | System Fault | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Information Technology | System Fault | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Information Technology | System Fault | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Information Technology | System Fault | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Chemical Engineering | Normal | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Chemical Engineering | Normal | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Chemical Engineering | Normal | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Chemical Engineering | Normal | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Chemical Engineering | Normal | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Chemical Engineering | Normal | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Chemical Engineering | Normal | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Chemical Engineering | Normal | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Chemical Engineering | Normal | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Chemical Engineering | Normal | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Chemical Engineering | Normal | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Chemical Engineering | Normal | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Chemical Engineering | Normal | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Chemical Engineering | Normal | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Chemical Engineering | Normal | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Chemical Engineering | Abnormal | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Chemical Engineering | Abnormal | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Chemical Engineering | Abnormal | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Chemical Engineering | Abnormal | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Chemical Engineering | Abnormal | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Chemical Engineering | Abnormal | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Chemical Engineering | Abnormal | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Chemical Engineering | Abnormal | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Chemical Engineering | Abnormal | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Chemical Engineering | Abnormal | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Chemical Engineering | Abnormal | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Chemical Engineering | Abnormal | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Chemical Engineering | Abnormal | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Chemical Engineering | Abnormal | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Chemical Engineering | Abnormal | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Aerospace Engineering | Serviceable | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Aerospace Engineering | Serviceable | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Aerospace Engineering | Serviceable | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Aerospace Engineering | Serviceable | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Aerospace Engineering | Serviceable | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Aerospace Engineering | Serviceable | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Aerospace Engineering | Serviceable | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Aerospace Engineering | Serviceable | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Aerospace Engineering | Serviceable | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Aerospace Engineering | Serviceable | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Aerospace Engineering | Serviceable | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Aerospace Engineering | Serviceable | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Aerospace Engineering | Serviceable | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Aerospace Engineering | Serviceable | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Aerospace Engineering | Serviceable | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Aerospace Engineering | Unserviceable | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Aerospace Engineering | Unserviceable | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Aerospace Engineering | Unserviceable | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Aerospace Engineering | Unserviceable | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Aerospace Engineering | Unserviceable | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Aerospace Engineering | Unserviceable | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Aerospace Engineering | Unserviceable | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Aerospace Engineering | Unserviceable | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Aerospace Engineering | Unserviceable | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Aerospace Engineering | Unserviceable | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Aerospace Engineering | Unserviceable | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Aerospace Engineering | Unserviceable | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Aerospace Engineering | Unserviceable | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Aerospace Engineering | Unserviceable | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Aerospace Engineering | Unserviceable | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Automobile Engineering | Safe to Drive | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Automobile Engineering | Safe to Drive | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Automobile Engineering | Safe to Drive | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Automobile Engineering | Safe to Drive | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Automobile Engineering | Safe to Drive | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Automobile Engineering | Safe to Drive | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Automobile Engineering | Safe to Drive | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Automobile Engineering | Safe to Drive | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Automobile Engineering | Safe to Drive | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Automobile Engineering | Safe to Drive | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Automobile Engineering | Safe to Drive | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Automobile Engineering | Safe to Drive | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Automobile Engineering | Safe to Drive | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Automobile Engineering | Safe to Drive | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Automobile Engineering | Safe to Drive | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Automobile Engineering | Unsafe to Drive | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Automobile Engineering | Unsafe to Drive | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Automobile Engineering | Unsafe to Drive | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Automobile Engineering | Unsafe to Drive | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Automobile Engineering | Unsafe to Drive | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Automobile Engineering | Unsafe to Drive | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Automobile Engineering | Unsafe to Drive | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Automobile Engineering | Unsafe to Drive | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Automobile Engineering | Unsafe to Drive | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Automobile Engineering | Unsafe to Drive | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Automobile Engineering | Unsafe to Drive | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Automobile Engineering | Unsafe to Drive | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Automobile Engineering | Unsafe to Drive | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Automobile Engineering | Unsafe to Drive | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Automobile Engineering | Unsafe to Drive | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Biomedical Engineering | Device Fault | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Biomedical Engineering | Device Fault | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Biomedical Engineering | Device Fault | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Biomedical Engineering | Device Fault | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Biomedical Engineering | Device Fault | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Biomedical Engineering | Device Fault | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Biomedical Engineering | Device Fault | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Biomedical Engineering | Device Fault | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Biomedical Engineering | Device Fault | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Biomedical Engineering | Device Fault | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Biomedical Engineering | Device Fault | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Biomedical Engineering | Device Fault | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Biomedical Engineering | Device Fault | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Biomedical Engineering | Device Fault | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Biomedical Engineering | Device Fault | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Biomedical Engineering | No Fault Found | perfect | 40 | 0 | 0 | 160 | 100.0 | 100.0 | 100.0 | 100.0 | 80.0 |
| Biomedical Engineering | No Fault Found | high_precision_low_recall | 4 | 0 | 36 | 160 | 100.0 | 10.0 | 18.2 | 82.0 | 80.0 |
| Biomedical Engineering | No Fault Found | low_precision_high_recall | 40 | 80 | 0 | 80 | 33.3 | 100.0 | 50.0 | 60.0 | 80.0 |
| Biomedical Engineering | No Fault Found | balanced_middle | 20 | 20 | 20 | 140 | 50.0 | 50.0 | 50.0 | 80.0 | 80.0 |
| Biomedical Engineering | No Fault Found | both_low | 5 | 45 | 35 | 115 | 10.0 | 12.5 | 11.1 | 60.0 | 80.0 |
| Biomedical Engineering | No Fault Found | equal_precision_recall | 30 | 10 | 10 | 50 | 75.0 | 75.0 | 75.0 | 80.0 | 60.0 |
| Biomedical Engineering | No Fault Found | precision_above_recall | 10 | 0 | 30 | 60 | 100.0 | 25.0 | 40.0 | 70.0 | 60.0 |
| Biomedical Engineering | No Fault Found | recall_above_precision | 30 | 20 | 0 | 50 | 60.0 | 100.0 | 75.0 | 80.0 | 70.0 |
| Biomedical Engineering | No Fault Found | no_flags | 0 | 0 | 40 | 160 | 0.0 | 0.0 | 0.0 | 80.0 | 80.0 |
| Biomedical Engineering | No Fault Found | no_hits | 0 | 20 | 40 | 140 | 0.0 | 0.0 | 0.0 | 70.0 | 80.0 |
| Biomedical Engineering | No Fault Found | all_flagged_positives | 40 | 160 | 0 | 0 | 20.0 | 100.0 | 33.3 | 20.0 | 80.0 |
| Biomedical Engineering | No Fault Found | one_of_each | 1 | 1 | 1 | 1 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
| Biomedical Engineering | No Fault Found | rare_positive | 1 | 0 | 0 | 199 | 100.0 | 100.0 | 100.0 | 100.0 | 99.5 |
| Biomedical Engineering | No Fault Found | mostly_false_alarms | 2 | 50 | 8 | 40 | 3.8 | 20.0 | 6.5 | 42.0 | 90.0 |
| Biomedical Engineering | No Fault Found | half_and_half | 50 | 50 | 50 | 50 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |
