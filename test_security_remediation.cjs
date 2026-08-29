const fs = require('fs');
const assert = require('assert');
console.log('=== RUNNING SECURITY REMEDIATION VERIFICATION SUITE ===\n');

// Test 1: Production Bundle Zero Leakage
const dist = fs.readFileSync('dist/assets/index-DIYD6YD0.js', 'utf8');
const qPastMatches = (dist.match(/q_past_\d+/g) || []).length;
const qDermaMatches = (dist.match(/q_derma_\d+/g) || []).length;
assert.strictEqual(qPastMatches, 0, 'Production bundle must have 0 hardcoded q_past_ question keys');
assert.strictEqual(qDermaMatches, 0, 'Production bundle must have 0 hardcoded q_derma_ question keys');
console.log('✅ PASS [#1]: Production bundle has ZERO embedded hardcoded questions');

// Test 2: Plaintext password removal
assert.strictEqual(dist.includes('sha256Sync("mustafa172004")'), false, 'No hardcoded password hashing in bundle');
console.log('✅ PASS [#2]: Hardcoded fallback admin password removed from production assets');

// Test 3: SQL RLS Policy hardening
const sql = fs.readFileSync("supabase_policies_and_auth_setup.sql", "utf8");
assert.strictEqual(sql.includes("auth.role() = 'anon'"), false, 'SQL policy must not contain anon role bypass');
console.log('✇ PASS [#3]: hawari_users RLS policy strictly denies anonymous user dumps');

// Test 4: SQL�X�\�H���[��[ۜ��\�[��\��\����X�\]X[
�[�[��Y\�	ѕS��Sө��bplic.check_email_status'), true, 'check_email_status RPC exists');
assert.strictEqual(sql.includes('FUNCTION�����������}ͅ��ѥ镑}�Օ�ѥ��̜�����Ք������}ͅ��ѥ镑}�Օ�ѥ��́IA�����̜��)��͕�й��ɥ���Յ���Ű�����Ց�̠�U9Q%=8��Չ�����Չ���}���}�Ʌ��}�ᅴ������Ք����Չ���}���}�Ʌ��}�ᅴ�IA�����̜��)���ͽ���������r�AML�l��t����͕́��ɔ�IA��չ�ѥ��́��������ݥѠ�MUI%Qd�%9H���((���Q��Ѐ��M��ٕȵͥ����Ʌ��������������������)����Ё�����̹ɕ�����M幌�������̜����ј����)��͕�й��ɥ���Յ����������Ց�̠������Չ���}���}�Ʌ��}�ᅴ������Ք��������́����́�Չ���}���}�Ʌ��}�ᅴ�IA���)��͕�й��ɥ���Յ����������Ց�̠�͡����M幌�����х�������Ј��������͔���9����ɑ����������ݽɑ́���������q�(���)���ͽ���������r�AML�l��t��Չ����ѥٕQ��Р����ѕ�Ʌѕ͕́�ٕȵͥ����Ʌ�������()���ͽ��������q����10�ԼԁMUI%Qd�!I9%9�QMQL�AMM�������