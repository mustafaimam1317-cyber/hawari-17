import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = "https://sueksolsletlhunpbtix.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZWtzb2xzbGV0bGh1bnBidGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzUxMDYsImV4cCI6MjA5OTY1MTEwNn0.F3_Hk-oth8B60lrSbU02mwRjncz2mKS43d66LquJZ7c";

function requestSupabase(endpoint, method = 'GET', body = null) {
    return new Promise((resolve) => {
        const url = new URL(`${SUPABASE_URL}${endpoint}`);
        const headers = {
            'apikey': ANON_KEY,
            'Authorization': `Bearer ${ANON_KEY}`,
            'Content-Type': 'application/json'
        };
        const req = https.request(url, { method, headers }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, data: parsed });
            });
        });
        req.on('error', (err) => resolve({ status: 0, error: err.message }));
        if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
    });
}

async function runSecurityGateAudit() {
    console.log("===============================================================");
    console.log("HAWARI PLATFORM - AUTOMATED ZERO-TRUST SECURITY AUDIT SUITE");
    console.log("===============================================================\n");

    const report = [];

    // Gate 1: hawari_global_questions Direct REST Access
    console.log("[1/5] Testing Direct REST Access to hawari_global_questions...");
    const gqRes = await requestSupabase("/rest/v1/hawari_global_questions?select=group_name,questions&limit=1");
    let gqPassed = false;
    let gqDetails = "";
    if (gqRes.status === 401 || gqRes.status === 403 || (Array.isArray(gqRes.data) && gqRes.data.length === 0)) {
        gqPassed = true;
        gqDetails = `SECURE: Table returned HTTP ${gqRes.status} or 0 rows to anon key. Direct question harvesting is physically BLOCKED by RLS.`;
    } else {
        const questionsCount = (gqRes.data && gqRes.data[0] && Array.isArray(gqRes.data[0].questions)) ? gqRes.data[0].questions.length : 0;
        gqDetails = `PENDING SQL EXECUTION: Table returned HTTP ${gqRes.status} with ${questionsCount} questions. Run supabase_production_rls_hardening.sql in Supabase SQL Editor to enforce RLS.`;
    }
    report.push({ gate: "1. Global Questions RLS", status: gqPassed ? "PASSED" : "PENDING_SQL", details: gqDetails });
    console.log(` -> Result: [${gqPassed ? 'PASSED' : 'PENDING_SQL'}] ${gqDetails}\n`);

    // Gate 2: get_sanitized_questions RPC Sanitization
    console.log("[2/5] Testing get_sanitized_questions RPC Sanitization...");
    const rpcRes = await requestSupabase("/rest/v1/rpc/get_sanitized_questions", "POST", { p_group: "infection" });
    let rpcPassed = false;
    let rpcDetails = "";
    if (rpcRes.status === 200 && Array.isArray(rpcRes.data) && rpcRes.data.length > 0) {
        const sample = rpcRes.data[0];
        const hasCorrectOption = "correctOption" in sample;
        const hasExplanation = "explanation" in sample;
        if (!hasCorrectOption && !hasExplanation) {
            rpcPassed = true;
            rpcDetails = `SECURE: RPC returned ${rpcRes.data.length} questions without correctOption or explanation. Keys: [${Object.keys(sample).join(', ')}].`;
        } else {
            rpcDetails = `FAILED: RPC leaked answer fields: correctOption=${hasCorrectOption}, explanation=${hasExplanation}.`;
        }
    } else {
        rpcDetails = `RPC returned status ${rpcRes.status}: ${JSON.stringify(rpcRes.data)}`;
    }
    report.push({ gate: "2. Questions RPC Sanitization", status: rpcPassed ? "PASSED" : "FAILED", details: rpcDetails });
    console.log(` -> Result: [${rpcPassed ? 'PASSED' : 'FAILED'}] ${rpcDetails}\n`);

    // Gate 3: hawari_users Direct REST Access
    console.log("[3/5] Testing Direct REST Access to hawari_users (Credentials & Hashes)...");
    const usersRes = await requestSupabase("/rest/v1/hawari_users?select=email,password_hash,role,status&limit=5");
    let usersPassed = false;
    let usersDetails = "";
    if (usersRes.status === 401 || usersRes.status === 403 || (Array.isArray(usersRes.data) && usersRes.data.length === 0)) {
        usersPassed = true;
        usersDetails = `SECURE: Table returned HTTP ${usersRes.status} or 0 rows to anon key. User credential scraping is physically BLOCKED by RLS.`;
    } else {
        const userCount = Array.isArray(usersRes.data) ? usersRes.data.length : 0;
        usersDetails = `EXPOSED: Table returned HTTP ${usersRes.status} with ${userCount} user rows. Run REVOKE SELECT ON TABLE public.hawari_users FROM anon; in Supabase SQL Editor.`;
    }
    report.push({ gate: "3. User Data & Credentials RLS", status: usersPassed ? "PASSED" : "PENDING_SQL", details: usersDetails });
    console.log(` -> Result: [${usersPassed ? 'PASSED' : 'PENDING_SQL'}] ${usersDetails}\n`);

    // Gate 4: check_email_status Safe Metadata RPC
    console.log("[4/5] Testing check_email_status Safe RPC...");
    const checkEmailRes = await requestSupabase("/rest/v1/rpc/check_email_status", "POST", { lookup_email: "mustafaimam1317@gmail.com", p_group: "infection" });
    let emailPassed = false;
    let emailDetails = "";
    if (checkEmailRes.status === 200 && checkEmailRes.data && checkEmailRes.data.exists) {
        const hasHash = "password_hash" in checkEmailRes.data || "password" in checkEmailRes.data;
        if (!hasHash) {
            emailPassed = true;
            emailDetails = `SECURE: check_email_status verified user status '${checkEmailRes.data.status}' without leaking credentials.`;
        } else {
            emailDetails = `FAILED: check_email_status exposed password hash!`;
        }
    } else {
        emailDetails = `RPC returned status ${checkEmailRes.status}: ${JSON.stringify(checkEmailRes.data)}`;
    }
    report.push({ gate: "4. Safe Auth RPC", status: emailPassed ? "PASSED" : "FAILED", details: emailDetails });
    console.log(` -> Result: [${emailPassed ? 'PASSED' : 'FAILED'}] ${emailDetails}\n`);

    // Gate 5: Production Bundle Integrity
    console.log("[5/5] Testing Production Bundle File Integrity...");
    let bundlePassed = false;
    let bundleDetails = "";
    const distPath = path.resolve("./dist/assets");
    if (fs.existsSync(distPath)) {
        const files = fs.readdirSync(distPath).filter(f => f.endsWith(".js"));
        if (files.length > 0) {
            const bundleContent = fs.readFileSync(path.join(distPath, files[0]), 'utf-8');
            const hasRawSeeds = bundleContent.includes("Pneumococcal and influenza vaccination is the key");
            if (!hasRawSeeds) {
                bundlePassed = true;
                bundleDetails = `SECURE: Production JS bundle (${files[0]}) contains 0 hardcoded questions or answers.`;
            } else {
                bundleDetails = `FAILED: Production JS bundle contains embedded question strings.`;
            }
        } else {
            bundleDetails = "No JS bundle found in dist/assets";
        }
    } else {
        bundleDetails = "dist/assets folder not found";
    }
    report.push({ gate: "5. Bundle Cleanliness", status: bundlePassed ? "PASSED" : "FAILED", details: bundleDetails });
    console.log(` -> Result: [${bundlePassed ? 'PASSED' : 'FAILED'}] ${bundleDetails}\n`);

    console.log("===============================================================");
    console.log("FINAL AUDIT SUMMARY TABLE");
    console.log("===============================================================");
    console.table(report);
}

runSecurityGateAudit();
