import fs from 'node:fs';

const SUPABASE_URL = 'https://sueksolsletlhunpbtix.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c';

async function main() {
  console.log('=== STARTING UPLOAD OF CAT-SCRATCH DISEASE REPORT ===\n');

  const file = 'report8_cat_scratch_disease.json';
  const raw = fs.readFileSync(file, 'utf8');
  const report = JSON.parse(raw);

  console.log(`[AUDIT] Validating Report: "${report.title}"`);
  console.log(`  ID: ${report.id}`);
  console.log(`  Group: ${report.group_name}`);
  console.log(`  Duration: ${report.time_limit} mins`);
  console.log(`  Question Count: ${report.question_ids.length}`);

  if (report.question_ids.length !== 10) {
    throw new Error(`Expected exactly 10 questions, found ${report.question_ids.length}`);
  }

  report.question_ids.forEach((q, idx) => {
    if (!q.id) throw new Error(`Question ${idx + 1} missing id!`);
    if (!q.text) throw new Error(`Question ${idx + 1} missing text!`);
    if (!q.options || !q.options.A || !q.options.B || !q.options.C || !q.options.D) {
      throw new Error(`Question ${idx + 1} missing options!`);
    }
    if (!q.correctOption) throw new Error(`Question ${idx + 1} missing correctOption!`);
    if (!q.explanation) throw new Error(`Question ${idx + 1} missing explanation!`);
    console.log(`  Q${idx + 1}: [${q.id}] Correct: ${q.correctOption} | Stem length: ${q.text.length}`);
  });

  console.log('\n[UPLOAD] Sending to Supabase hawari_report_tasks...');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/hawari_report_tasks`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(report)
  });

  if (res.ok || res.status === 201 || res.status === 204) {
    console.log(`  -> SUCCESS! HTTP Status: ${res.status}`);
  } else {
    const errText = await res.text();
    console.error(`  -> ERROR:`, res.status, errText);
    process.exit(1);
  }

  // Verification
  console.log('\n[VERIFY] Querying live database...');
  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/hawari_report_tasks?id=eq.${encodeURIComponent(report.id)}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
  });
  const checkData = await checkRes.json();

  if (checkData && checkData.length > 0) {
    const live = checkData[0];
    console.log('\n=============================================');
    console.log('🎉 REPORT IS OFFICIALLY LIVE IN SUPABASE CLOUD!');
    console.log('=============================================');
    console.log(`Title: "${live.title}"`);
    console.log(`ID: ${live.id}`);
    console.log(`Group: ${live.group_name}`);
    console.log(`Time Limit: ${live.time_limit} minutes`);
    console.log(`Total Questions: ${live.question_ids?.length}`);
    console.log('All 10 questions, clinical options, and explanations verified.');
  } else {
    console.error('[ERROR] Could not verify report in live DB!');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
