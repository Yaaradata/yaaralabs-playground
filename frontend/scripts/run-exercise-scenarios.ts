import { runAllScenarios, summarizeScenarios } from '../components/Exercises/runScenarios';

const results = runAllScenarios();
const summary = summarizeScenarios(results);
const failed = results.filter((r) => !r.ok);

console.log('Exercises scenario report');
console.log(`Total: ${summary.total}  passed: ${summary.passed}  failed: ${summary.failed}`);
Object.entries(summary.byExercise)
  .sort((a, b) => Number(a[0]) - Number(b[0]))
  .forEach(([id, counts]) => {
    console.log(`  Exercise ${id}: ${counts.passed} passed, ${counts.failed} failed`);
  });

if (failed.length) {
  console.log('\nFailures:');
  failed.forEach((row) => {
    console.log(`  E${row.exercise} ${row.example} (${row.title}): ${row.detail}`);
  });
  process.exit(1);
}

console.log('\nAll 100 named examples passed (10 per remaining exercise), plus edge-case guards.');
