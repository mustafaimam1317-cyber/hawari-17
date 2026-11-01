import fs from 'fs';
import pg from 'pg';
const { Client } = pg;

const client = new Client({
    host: 'aws-1-eu-central-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.vjbweuzwpzjkskylgvez',
    password: '30407011316392',
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
});

async function main() {
    console.log('=== STARTING INSERTION OF SIX WEEK EXAM REPORT TASK ===\n');

    const raw = fs.readFileSync('report9_six_week_exam.json', 'utf8');
    const report = JSON.parse(raw);

    console.log(`[AUDIT] Validating Report: "${report.title}"`);
    console.log(`  ID: ${report.id}`);
    console.log(`  Group: ${report.group_name}`);
    console.log(`  Duration: ${report.time_limit} mins`);
    console.log(`  Question Count: ${report.question_ids.length}`);

    if (report.question_ids.length !== 30) {
        throw new Error(`Expected exactly 30 questions, found ${report.question_ids.length}`);
    }

    report.question_ids.forEach((q, idx) => {
        if (!q.id) throw new Error(`Question ${idx + 1} missing id!`);
        if (!q.text) throw new Error(`Question ${idx + 1} missing text!`);
        if (!q.options || Object.keys(q.options).length < 4) {
            throw new Error(`Question ${idx + 1} missing options!`);
        }
        if (!q.correctOption) throw new Error(`Question ${idx + 1} missing correctOption!`);
        if (!q.options[q.correctOption]) {
            throw new Error(`Question ${idx + 1}: correctOption "${q.correctOption}" not in options!`);
        }
        if (!q.explanation) throw new Error(`Question ${idx + 1} missing explanation!`);
    });

    console.log('  -> All 30 questions thoroughly validated!');

    await client.connect();
    console.log('\n[DATABASE] Connected to Supabase PostgreSQL database.');

    // Ensure it does NOT exist in hawari_course_quizzes
    const checkQuiz = await client.query("SELECT id FROM hawari_course_quizzes WHERE id = $1", [report.id]);
    if (checkQuiz.rows.length > 0) {
        console.log(`[NOTICE] Removing conflicting entry from hawari_course_quizzes if any...`);
        await client.query("DELETE FROM hawari_course_quizzes WHERE id = $1", [report.id]);
    }

    // Insert into hawari_report_tasks
    const insertSql = `
        INSERT INTO hawari_report_tasks (id, group_name, title, time_limit, date_created, question_ids, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET
            group_name = EXCLUDED.group_name,
            title = EXCLUDED.title,
            time_limit = EXCLUDED.time_limit,
            question_ids = EXCLUDED.question_ids,
            updated_at = now();
    `;

    await client.query(insertSql, [
        report.id,
        report.group_name,
        report.title,
        report.time_limit,
        report.date_created,
        JSON.stringify(report.question_ids)
    ]);
    console.log('[DATABASE] Successfully upserted into hawari_report_tasks!');

    // Verify retrieval
    const verifyRes = await client.query(`
        SELECT id, title, group_name, time_limit, updated_at, jsonb_array_length(question_ids) as q_count
        FROM hawari_report_tasks
        WHERE id = $1
    `, [report.id]);
    console.table(verifyRes.rows);

    // Verify grading RPC works with this exam
    console.log('\n[RPC TEST] Testing submit_and_grade_exam RPC...');
    const rpcRes = await client.query(`
        SELECT submit_and_grade_exam($1, $2, $3, $4, $5) as result
    `, [
        'infection',
        report.id,
        JSON.stringify({ swe_q01: 'C', swe_q02: 'A', swe_q03: 'D' }),
        'student_test@example.com',
        JSON.stringify(['swe_q01', 'swe_q02', 'swe_q03'])
    ]);
    console.log('RPC Tutor Mode Result:', JSON.stringify(rpcRes.rows[0].result, null, 2));

    await client.end();
    console.log('\n=== INSERTION & AUDIT COMPLETED WITH 100% SUCCESS ===');
}

main().catch(err => {
    console.error('Fatal error during insertion:', err);
    process.exit(1);
});
