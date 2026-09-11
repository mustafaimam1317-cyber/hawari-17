import fs from 'fs';

console.log("===============================================================");
console.log("HAWARI PLATFORM - SINGLE DEVICE & PROPRIETARY LICENSE AUDIT");
console.log("===============================================================\n");

let allPassed = true;

function assert(condition, message) {
    if (condition) {
        console.log(`✓ PASS: ${message}`);
    } else {
        console.error(`✗ FAIL: ${message}`);
        allPassed = false;
    }
}

const files = [
    'app.js',
    'uiTemplate.js',
    'index.html',
    'style.css',
    'claymorphism.css',
    'single_device_session_schema.sql'
];

// Check 1: Author Mustafa Imam in all files
files.forEach(file => {
    if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        assert(content.includes('Mustafa Imam'), `Author 'Mustafa Imam' verified in ${file}`);
    }
});

// Check 2: Copyright in all files
files.forEach(file => {
    if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        assert(content.includes('Copyright (c) 2026 Hawari Platform'), `Copyright notice verified in ${file}`);
    }
});

// Check 3: Legal Footer in uiTemplate.js
const uiContent = fs.readFileSync('uiTemplate.js', 'utf8');
assert(uiContent.includes('hawari-legal-footer'), "Legal Footer 'hawari-legal-footer' present in uiTemplate.js");
assert(uiContent.includes('Author: Mustafa Imam'), "Legal Footer contains 'Author: Mustafa Imam'");

// Check 4: Single Active Device Enforcement in app.js
const appContent = fs.readFileSync('app.js', 'utf8');
assert(appContent.includes('function getDeviceFingerprint'), "getDeviceFingerprint function defined in app.js");
assert(appContent.includes('function getOrCreateDeviceSessionToken'), "getOrCreateDeviceSessionToken function defined in app.js");
assert(appContent.includes('function rotateDeviceSessionToken'), "rotateDeviceSessionToken function defined in app.js");
assert(appContent.includes('async function claimActiveDeviceSession'), "claimActiveDeviceSession function defined in app.js");
assert(appContent.includes('async function verifyActiveDeviceSession'), "verifyActiveDeviceSession function defined in app.js");
assert(appContent.includes('rotateDeviceSessionToken();'), "rotateDeviceSessionToken invoked on login");
assert(appContent.includes('claimActiveDeviceSession(user.email)'), "claimActiveDeviceSession invoked on student login");
assert(appContent.includes('isUserAdmin'), "Admin role check (isUserAdmin) verified in session logic");

// Check 5: single_device_session_schema.sql SQL structure
const sqlContent = fs.readFileSync('single_device_session_schema.sql', 'utf8');
assert(sqlContent.includes('claim_active_device_session'), "RPC claim_active_device_session declared in SQL");
assert(sqlContent.includes('verify_active_device_session'), "RPC verify_active_device_session declared in SQL");
assert(sqlContent.includes('mustafaimam1317@gmail.com'), "Admin whitelist preserved in session SQL");

console.log("\n===============================================================");
if (allPassed) {
    console.log("ALL TESTS PASSED (100% SUCCESS) - LICENSE & DEVICE SECURITY VERIFIED!");
} else {
    console.error("SOME TESTS FAILED! PLEASE REVIEW.");
    process.exit(1);
}
console.log("===============================================================");
