import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, openSync, closeSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// WP-32 continuation of the accepted bound-source runner. This executor owns
// one disposable runtime from authenticated enrollment through native M3 and
// M4 evidence. It never targets production and never changes source files.
const cwd = process.cwd();
const root = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(`${cwd}/package.json`);
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');
const { BoundFileScanWorker, requestBoundFileScan } = require(`${cwd}/lib/integration-gateway/file-intake/bound-scan.ts`);
const { disposableScanStorage } = require(`${cwd}/tests/ap1/environment/bound-scan-storage.ts`);
const { registerBoundChildSource } = require(`${cwd}/tests/ap1/environment/register-bound-child-source.ts`);
const { semanticHash, validateLayoutDocument } = require(`${cwd}/lib/layout-studio/domain/index.ts`);
const { buildBaselineSnapshot } = require(`${cwd}/lib/project-intelligence/modules/decisions/baseline-snapshot.ts`);
const { ProjectCeoAuthenticatedReadPostgresAdapter } = require(`${cwd}/lib/project-intelligence/adapters/postgres/authenticated-read.ts`);
const { canonicalJson } = require(`${cwd}/lib/project-intelligence/application/change-handoff/canonical.ts`);
const { projectCeoCommandSchema } = require(`${cwd}/lib/project-intelligence/delivery/projectceo/command-contract.ts`);
const { initializeBoundScanner, scanClaimedBytes } = require(`${cwd}/tests/pilot-evidence/executors/wp32-bound-scanner.ts`);
const out = mkdtempSync('/private/tmp/remhaos-architect-intake-');
const cliProfile = mkdtempSync('/private/tmp/remhaos-architect-cli-');
const userHome = homedir();
const cli = join(userHome,'.local/bin/supabase');
const db = 'supabase_db_archidom-ap1-disposable';
const origin = 'http://127.0.0.1:3100';
const api = 'http://127.0.0.1:59621';
const fastDiagnostic=process.env.WP32_FAST_DIAGNOSTIC==='1';
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  DOCKER_HOST: `unix://${join(userHome,'.colima/archidom-ap1-disposable/docker.sock')}`,
  AP1_SUPABASE_BIN: cli, SUPABASE_TELEMETRY_DISABLED: '1', NEXT_TELEMETRY_DISABLED: '1',
  SUPABASE_HOME: cliProfile, AP1_CLI_HOME: cliProfile, SUPABASE_NO_KEYRING: '1', SUPABASE_PROFILE: 'supabase',
};
const sha = b => createHash('sha256').update(b).digest('hex');
const safeCode = v => typeof v === 'string' && /^[A-Za-z0-9_:-]{1,110}$/.test(v) ? v : 'REDACTED_ERROR';
function detailField(error, key) { try { return JSON.parse(error?.details ?? '{}')?.[key]; } catch { return null; } }
const report = { schema: 'remhaos.wp32-external-runtime/1', startedAt: new Date().toISOString(),
  sourceCommit: null,
  sourceBinding: 'local-inventory-sha256', environment: 'local_disposable', status: 'running',
  productionChanged: false, scannerRun: false, fullExternalE2E: false, checks: [], sources: [] };
let app, started = false, stage = 'preflight', selectedSources = [];
function check(name, pass, extra = {}) { report.checks.push({ name, pass, ...extra }); }
function assert(ok, code) { if (!ok) throw new Error(code); }
function save() { writeFileSync(`${out}/evidence.json`, JSON.stringify(report, null, 2), { mode: 0o600 }); }
function run(command, args, input) {
  const fd = openSync(`${out}/${stage}.log`, 'w', 0o600);
  try { const r = spawnSync(command, args, { cwd, env, input, stdio: ['pipe', fd, fd], timeout: 900000 });
    assert(r.status === 0, `STAGE_FAILED:${stage}`);
  } finally { closeSync(fd); }
}
function sqlRead(query) {
  assert(/^select\s/i.test(query.trim()) && !/;\s*\S/.test(query), 'READ_ONLY_QUERY_REQUIRED');
  const r = spawnSync('docker', ['exec', '-i', db, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'],
    { cwd, env, input: query, encoding: 'utf8', timeout: 30000 });
  assert(r.status === 0, 'DIAGNOSTIC_QUERY_FAILED');
  try { return JSON.parse(r.stdout.trim()); } catch { throw new Error('DIAGNOSTIC_RESULT_NOT_JSON'); }
}
function collectRuntimeDiagnostics() {
  const storageName = 'supabase_storage_archidom-ap1-disposable';
  const inspect = spawnSync('docker', ['inspect', '--format', '{{json .State}}', storageName], { env, encoding: 'utf8', timeout: 15000 });
  if (inspect.status === 0) {
    const state = JSON.parse(inspect.stdout);
    report.storageState = { status: state.Status, oomKilled: state.OOMKilled, exitCode: state.ExitCode, health: state.Health?.Status };
  }
  const logs = spawnSync('docker', ['logs', '--tail', '100', storageName], { env, encoding: 'utf8', timeout: 15000 });
  const text = `${logs.stdout ?? ''}\n${logs.stderr ?? ''}`;
  // Collect only exact allowlisted diagnostic fragments, never raw request logs.
  const patterns = [/ECONNREFUSED/g, /ENOTFOUND/g, /ETIMEDOUT/g, /Connection terminated unexpectedly/gi,
    /new row violates row-level security policy/gi, /permission denied for (?:table|schema|function) [A-Za-z0-9_]+/gi,
    /relation "[A-Za-z0-9_.]+" does not exist/g, /KnexTimeoutError/g, /Timeout acquiring a connection/gi,
    /connect ECONNREFUSED [0-9.:]+/g, /out of memory/gi];
  report.storageLogCategories = [...new Set(patterns.flatMap(p => text.match(p) ?? []))];
  report.storageLogObservedBytes = text.length;
  report.storagePolicies = sqlRead("select coalesce(json_agg(json_build_object('name',policyname,'command',cmd)),'[]'::json) from pg_policies where schemaname='storage' and tablename='objects'");
  report.databaseWaits = sqlRead("select coalesce(json_agg(json_build_object('state',state,'type',wait_event_type,'event',wait_event)),'[]'::json) from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid()");
}
async function rpc(client, schema, name, args) {
  const { data, error } = await client.schema(schema).rpc(name, args);
  if (error) throw new Error(`RPC_${name}:${safeCode(error.code)}`);
  return data;
}
async function identity(admin, anon, key) {
  const password = randomBytes(32).toString('hex');
  const email = `${key}-${randomUUID()}@architect.local.invalid`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert(!created.error && created.data.user, 'IDENTITY_CREATE_FAILED');
  const jar = new Map();
  const client = createServerClient(api, anon, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: list => list.forEach(c => jar.set(c.name, c.value)),
  }});
  const login = await client.auth.signInWithPassword({ email, password });
  assert(!login.error && login.data.session, 'IDENTITY_LOGIN_FAILED');
  const claims = await client.auth.getClaims();
  assert(!claims.error && claims.data.claims.sub === created.data.user.id, 'IDENTITY_CLAIMS_FAILED');
  return { client, jar, userId: created.data.user.id, sessionId: claims.data.claims.session_id };
}
async function request(actor, path, options = {}) {
  assert(path.startsWith('/api/'), 'LOCAL_ROUTE_REQUIRED');
  const cookie = actor ? [...actor.jar].map(([k, v]) => `${k}=${v}`).join('; ') : '';
  const response = await fetch(origin + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body, cache: response.headers.get('cache-control'),
    sessionDigest: response.headers.get('x-archidom-auth-session-digest') };
}
async function projectState(actor, projectId) {
  const visible=await rpc(actor.client,'projectceo_api','list_projects',{});
  const project=visible.data.find(item=>item.projectId===projectId);assert(project,'PROJECT_STATE_NOT_VISIBLE');return project.stateRevision;
}
async function command(actor, projectId, kind, payload, label=kind, replayRequired=true) {
  const commandId=randomUUID();
  const body={contractVersion:'projectceo-command/0.1',kind,projectId,commandId,payload};
  const first=await request(actor,'/api/projectceo/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(first.status!==200||first.body?.status!=='completed'||first.body?.replay!==false){
    report.commandFailures=[...(report.commandFailures??[]),{label,phase:'first',httpStatus:first.status,
      status:safeCode(first.body?.status??'none'),code:safeCode(first.body?.error?.code??'none')}];save();
  }
  assert(first.status===200&&first.body?.status==='completed'&&first.body?.replay===false,`COMMAND_FIRST_FAILED:${label}`);
  assert(first.sessionDigest,`COMMAND_SESSION_PROVENANCE_MISSING:${label}`);
  if(!replayRequired){
    report.idempotencyGaps=[...(report.idempotencyGaps??[]),{operation:kind,reason:'HTTP_SETUP_REPLAY_NOT_REQUIRED_BY_THIS_RUN'}];
    return {commandId,first:first.body,replay:null,sessionDigest:first.sessionDigest};
  }
  const replay=await request(actor,'/api/projectceo/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(replay.status!==200||replay.body?.status!=='completed'||replay.body?.replay!==true){
    report.commandFailures=[...(report.commandFailures??[]),{label,phase:'replay',httpStatus:replay.status,
      status:safeCode(replay.body?.status??'none'),code:safeCode(replay.body?.error?.code??'none')}];save();
  }
  assert(replay.status===200&&replay.body?.status==='completed'&&replay.body?.replay===true,`COMMAND_REPLAY_FAILED:${label}`);
  assert(canonicalJson(first.body.result)===canonicalJson(replay.body.result),`COMMAND_REPLAY_CHANGED:${label}`);
  assert(first.sessionDigest&&first.sessionDigest===replay.sessionDigest,`COMMAND_SESSION_PROVENANCE_MISSING:${label}`);
  return {commandId,first:first.body,replay:replay.body,sessionDigest:first.sessionDigest};
}
async function publishFreshBaseline(actor,projectId,label) {
  for(let attempt=1;attempt<=3;attempt++){
    const workspace=await request(actor,`/api/projectceo/projects/${projectId}`);
    assert(workspace.status===200&&workspace.body?.error===null,`${label}:PREVIEW_FAILED`);
    const routeToken=workspace.body.data?.operations?.publish_baseline?.commandTargetId;
    assert(/^sha256:[0-9a-f]{64}$/.test(routeToken),`${label}:TOKEN_MISSING`);
    const raw=await new ProjectCeoAuthenticatedReadPostgresAdapter(actor.client).getProjectWorkspaceRead({projectId,packageId:null});
    assert(!raw.error&&raw.data,`${label}:RAW_READ_FAILED`);
    const rawToken=buildBaselineSnapshot({approvalPackages:raw.data.approvalPackages.map(entry=>({id:String(entry.id??''),
      status:String(entry.status??''),createdAt:String(entry.createdAt??''),items:(entry.items??[]).map(item=>({targetKind:String(item.targetKind??''),
        entityId:String(item.entityId??''),revisionId:String(item.revisionId??'')}))})),packageIds:raw.data.packages.map(entry=>String(entry.id??'')),
      previousBaselineId:typeof raw.data.latestBaseline?.id==='string'?raw.data.latestBaseline.id:null}).token;
    report.baselineTokenComparisons=[...(report.baselineTokenComparisons??[]),{label,attempt,routeMatchesRaw:routeToken===rawToken}];save();
    const snapshotToken=fastDiagnostic&&routeToken!==rawToken?rawToken:routeToken;
    const commandId=randomUUID();
    const body={contractVersion:'projectceo-command/0.1',kind:'publish_baseline',projectId,commandId,payload:{snapshotToken}};
    const response=await request(actor,'/api/projectceo/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(response.status===200&&response.body?.status==='completed'){
      assert(response.sessionDigest,`${label}:SESSION_PROVENANCE_MISSING`);
      return {commandId,first:response.body,replay:null,sessionDigest:response.sessionDigest,snapshotToken,attempt};
    }
    const code=safeCode(response.body?.error?.code??'none');
    report.baselineAttempts=[...(report.baselineAttempts??[]),{label,attempt,httpStatus:response.status,code}];save();
    if(response.status!==409||code!=='stale_state') throw new Error(`${label}:FAILED`);
  }
  throw new Error(`${label}:STALE_RETRY_EXHAUSTED`);
}
console.log(`ARCHITECT_INTAKE_OUTPUT=${out}`);
try {
  const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: 10000 });
  assert(gitHead.status === 0, 'SOURCE_HEAD_UNAVAILABLE');
  report.sourceCommit = gitHead.stdout.trim();
  await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', () => reject(new Error('APP_PORT_IN_USE')));
    probe.listen(3100, '127.0.0.1', () => probe.close(resolve));
  });
  assert(!readdirSync(cwd).some(n => /^\.env(?:\.|$)/.test(n) && n !== '.env.example'), 'UNISOLATED_CHECKOUT');
  assert(!existsSync(`${cwd}/supabase/.temp/project-ref`), 'LINKED_PROJECT_REJECTED');
  const containers = spawnSync('docker', ['ps', '-aq'], { env, encoding: 'utf8', timeout: 30000 });
  assert(containers.status === 0, 'DISPOSABLE_DOCKER_ACCESS_FAILED');
  assert(!containers.stdout.trim(), 'DISPOSABLE_PROFILE_NOT_EMPTY');
  stage = 'scanner-controls';
  report.fastDiagnostic=fastDiagnostic;
  const scanPolicy = await initializeBoundScanner({diagnosticSkipControls:fastDiagnostic});
  report.scanPolicy = scanPolicy;
  const inventory = JSON.parse(readFileSync(`${root}/artifacts/ARCHITECT_LOCAL_SOURCE_INVENTORY_20260923.json`, 'utf8'));
  const expected = ['99a44ddb01fed41d5b6b9d7f2bce36cf6245394fdd9dedba33b3c15ae4be5eba',
    'f6096a9857d163f0348ef057531790a20c847542a954f67e748b53c033afc654',
    '9258296141ea1dfc5f9a2b34f25224a6a4cd8d728e6361e0765cb36efc3568d3'];
  const sources = expected.map((digest, index) => {
    const entry = inventory.rows.find(r => r.sha256 === digest); assert(entry, 'SOURCE_NOT_IN_INVENTORY');
    const sourcePath = `${entry.root}/${entry.path}`;
    const bytes = readFileSync(sourcePath); assert(sha(bytes) === digest, 'SOURCE_HASH_CHANGED');
    const extension = index === 0 ? 'pdf' : index === 1 ? 'xlsx' : 'png';
    return { sourcePath, bytes, digest, alias: `architect-source-${index + 1}.${extension}`,
      mime: index === 0 ? 'application/pdf' : index === 1
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'image/png',
      sourceRole:index===2?'photo-evidence':'document' };
  });
  selectedSources = sources;
  report.harnessSha256 = sha(readFileSync(new URL(import.meta.url)));
  report.scannerHarnessSha256 = sha(readFileSync(`${cwd}/tests/pilot-evidence/executors/wp32-bound-scanner.ts`));
  report.anchorParserSha256=sha(readFileSync('/private/tmp/wp32-source-anchor.py'));
  report.lockfileSha256 = sha(readFileSync(`${cwd}/package-lock.json`));
  report.candidateFiles = Object.fromEntries([
    'tests/ap1/environment/register-bound-child-source.ts',
    'supabase/migrations/20260923110410_remhaos_bound_file_scan_completion.sql',
    'lib/integration-gateway/file-intake/bound-scan.ts',
    'tests/ap1/environment/bound-scan-storage.ts',
    'tests/ap1/environment/enable-bound-file-scanner.sql',
    'supabase/migrations/20260923060722_remhaos_file_intake_quarantine_insert.sql',
    'tests/ap1/environment/migration-ledger.sha256', 'tests/db4/run.zsh',
    'tests/db4/79_file_intake_quarantine_authorization.sql',
    'lib/project-intelligence/adapters/postgres/errors.ts', 'lib/integration-gateway/file-intake/http.test.ts',
    'lib/integration-gateway/file-intake/service.ts', 'lib/integration-gateway/file-intake/service.test.ts',
  ].map(path => [path, sha(readFileSync(`${cwd}/${path}`))]));
  stage = 'stack-start'; started = true; save();
  run('zsh', ['tests/ap1/environment/run-local.zsh', 'start']);
  // Bound only the owned disposable stack before admitting a 3-GiB AV job.
  stage = 'disposable-service-limits';
  const stackNames = spawnSync('docker', ['ps','--format','{{.Names}}'], {env,encoding:'utf8',timeout:15000});
  assert(stackNames.status===0,'STACK_INVENTORY_FAILED');
  const allowed = { db:768, auth:192, rest:192, storage:384, kong:192 };
  report.serviceLimits = [];
  for (const name of stackNames.stdout.trim().split('\n')) {
    const kind = name.match(/^supabase_(db|auth|rest|storage|kong)_archidom-ap1-disposable$/)?.[1];
    assert(kind && allowed[kind], 'UNEXPECTED_DISPOSABLE_SERVICE');
    const r = spawnSync('docker',['update',`--memory=${allowed[kind]}m`,`--memory-swap=${allowed[kind]}m`,name],{env,encoding:'utf8',timeout:15000});
    assert(r.status===0,'DISPOSABLE_SERVICE_CAP_FAILED');
    report.serviceLimits.push({kind,memoryMiB:allowed[kind]});
  }
  stage = 'scanner-disposable-gate';
  run('docker',['exec','-i',db,'psql','-Xq','-v','ON_ERROR_STOP=1','-v',`scan_policy_json=${JSON.stringify(scanPolicy)}`,'-U','postgres'],
    readFileSync(`${cwd}/tests/ap1/environment/enable-bound-file-scanner.sql`));
  for (const gate of ['enable-m3-publication.sql','enable-native-m3-context.sql','enable-m4-increment-1.sql','enable-m4-v1-impact.sql','enable-m4-v2-v3.sql']) {
    stage = `gate-${gate.replace(/\.sql$/, '')}`;
    run('docker',['exec','-i',db,'psql','-Xq','-v','ON_ERROR_STOP=1','-U','postgres'],
      readFileSync(`${cwd}/tests/ap1/environment/${gate}`));
  }
  const state = spawnSync(cli, ['status', '--output', 'json', '--workdir', cwd, '--profile', 'supabase'],
    { cwd, env, encoding: 'utf8', timeout: 30000 });
  assert(state.status === 0, 'STATUS_FAILED');
  const values = JSON.parse(state.stdout);
  assert(values.API_URL === api && new URL(values.DB_URL).hostname === '127.0.0.1' && new URL(values.DB_URL).port === '59622', 'NONLOCAL_TARGET');
  assert(values.ANON_KEY && values.SERVICE_ROLE_KEY, 'LOCAL_KEYS_MISSING');
  const admin = createClient(api, values.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  Object.assign(env, { NEXT_PUBLIC_SUPABASE_URL: api, NEXT_PUBLIC_SUPABASE_ANON_KEY: values.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL: origin,
    PROJECTCEO_TOKEN_SECRET: randomBytes(48).toString('base64'),
    REMHAOS_FILE_INTAKE_ENABLED: 'true', REMHAOS_EXECUTION_ENABLED: 'true',
    REMHAOS_DOCUMENTATION_ENABLED: 'true', REMHAOS_M4_V2_V3_ENABLED: 'true', PORT: '3100' });
  stage = 'identities';
  const owner = await identity(admin, values.ANON_KEY, 'owner');
  const architect = await identity(admin, values.ANON_KEY, 'architect');
  const builder = await identity(admin, values.ANON_KEY, 'builder');
  const client = await identity(admin, values.ANON_KEY, 'client');
  const outsider = await identity(admin, values.ANON_KEY, 'outsider');
  // Only Auth identity creation uses the admin client; all business creation uses human RLS/RPC.
  stage = 'authenticated-project';
  const designer = await owner.client.from('designers').insert({ id: owner.userId, name: 'Disposable source reviewer' });
  assert(!designer.error, `DESIGNER_CREATE:${safeCode(designer.error?.code ?? 'unknown')}`);
  const projectId = randomUUID(), packageId = randomUUID();
  const project = await owner.client.from('projects').insert({ id: projectId, designer_id: owner.userId,
    client_name: 'The Abian House — disposable verification', intake_token: randomBytes(32).toString('hex'),
    passport: { project_name: 'The Abian House', object: { type: 'house', area_m2: 652.1, city: 'Pejeng Kelod, Gianyar' } } });
  assert(!project.error, `PROJECT_CREATE:${safeCode(project.error?.code ?? 'unknown')}`);
  stage = 'authenticated-enrollment';
  const enrollArgs = { project_id: projectId, package_id: packageId, package_stable_key: 'the-abian-external-package',
    package_name: 'The Abian House source package', members: [
      { userId: architect.userId, role: 'architect' }, { userId: builder.userId, role: 'builder' },
      { userId: client.userId, role: 'client_approver' }], idempotency_key: `enroll:${randomUUID()}` };
  const enrollment = await rpc(owner.client, 'projectceo_api', 'enroll_organization_project_scope', enrollArgs);
  const enrollmentReplay = await rpc(owner.client, 'projectceo_api', 'enroll_organization_project_scope', enrollArgs);
  check('authenticated_enrollment_replay', enrollmentReplay.replay === true && JSON.stringify(enrollmentReplay.result) === JSON.stringify(enrollment.result));
  assert(report.checks.at(-1).pass, 'ENROLLMENT_REPLAY_FAILED');
  report.scope = { projectId, packageId, organizationId: enrollment.result.organizationId, intakeScope: 'work_package' };
  // Read-only auth.sessions diagnostic, not a fabricated session proof or business write.
  stage = 'auth-session-diagnostic';
  assert(/^[a-f0-9-]{36}$/.test(owner.sessionId), 'INVALID_SESSION_ID');
  check('auth_session_server_present', sqlRead(`select to_json(exists(select 1 from auth.sessions where id='${owner.sessionId}'::uuid and user_id='${owner.userId}'::uuid))`));
  stage = 'app-start';
  const appLog = openSync(`${out}/app.log`, 'w', 0o600);
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3100'],
    { cwd, env, stdio: ['ignore', appLog, appLog] }); closeSync(appLog);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (app.exitCode !== null) throw new Error('APP_EXITED');
    try { const r = await request(null, `/api/projects/${projectId}/file-intakes`); if (r.status === 401) { ready = true; break; } }
    catch { /* startup only */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  assert(ready, 'APP_AUTH_ROUTE_NOT_READY');
  check('anonymous_denied', true);
  const route = `/api/projects/${projectId}/file-intakes`;
  const outsiderList = await request(outsider, route);
  check('outsider_list_denied', [403,404].includes(outsiderList.status), { httpStatus: outsiderList.status });
  assert(report.checks.at(-1).pass, 'OUTSIDER_LIST_AUTHORIZATION_PROOF_UNPROVEN');
  const decisionNodeId='abian-design-intent';
  let bootstrapDecisionRevisionId=null,sourceSnapshotId=null;
  stage = 'real-source-intake';
  for (const [sourceIndex,source] of sources.entries()) {
    const entry = { alias: source.alias, sourceSha256: source.digest, byteLength: source.bytes.length };
    report.sources.push(entry);
    const key = `intake:${randomUUID()}`;
    const upload = actor => {
      const form = new FormData(); form.set('file', new Blob([source.bytes], { type: source.mime }), source.alias);
      form.set('sourceRole', source.sourceRole);
      return request(actor, route, { method: 'POST', headers: { 'Idempotency-Key': key }, body: form });
    };
    const denied = await upload(outsider);
    check(`${source.alias}:outsider_upload_denied`, [403,404].includes(denied.status), { httpStatus: denied.status });
    assert(report.checks.at(-1).pass, 'OUTSIDER_UPLOAD_AUTHORIZATION_PROOF_UNPROVEN');
    const first = await upload(owner);
    entry.firstHttpStatus = first.status; entry.errorCode = safeCode(first.body?.error?.code ?? 'none');
    if (first.status !== 201) {
      // Same authenticated actor/key/bytes; diagnostic result is NOT HTTP-flow proof.
      const diagnostic = await owner.client.schema('remhaos_integration_api').rpc('create_file_intake', {
        p_project_id: projectId, p_original_filename: source.alias, p_media_type: source.mime,
        p_extension: source.alias.split('.').at(-1), p_size_bytes: source.bytes.length,
        p_checksum_hex: source.digest, p_source_role: source.sourceRole, p_idempotency_key: key });
      entry.createDiagnostic = { code: safeCode(diagnostic.error?.code ?? 'none'),
        reason: safeCode(detailField(diagnostic.error, 'reason') ?? 'none'),
        field: safeCode(detailField(diagnostic.error, 'field') ?? 'none'),
        resultKeys: Object.keys(diagnostic.data ?? {}).sort(),
        authorizationKeys: Object.keys(diagnostic.data?.result ?? {}).sort(),
        returnedStatus: safeCode(diagnostic.data?.result?.status ?? 'none') };
      if (diagnostic.data?.result?.status === 'requested') {
        const authorization = diagnostic.data.result;
        const store = await owner.client.storage.from('client-uploads').upload(authorization.objectKey, source.bytes,
          { contentType: source.mime, upsert: false });
        entry.storageDiagnostic = { code: safeCode(store.error?.code ?? 'none'),
          statusCode: safeCode(String(store.error?.statusCode ?? 'none')),
          rowSecurityDenied: /row.level security/i.test(store.error?.message ?? '') };
      }
      entry.serverRowsDiagnostic = sqlRead(`select coalesce(json_agg(json_build_object('status',status,'sha256',encode(checksum,'hex'),'actorMatches',created_by_user_id='${owner.userId}'::uuid)),'[]'::json) from remhaos_integration.file_intakes where project_id='${projectId}'::uuid`);
      collectRuntimeDiagnostics();
      save();
    }
    assert(first.status === 201 && first.body.data?.result, 'REAL_UPLOAD_FAILED');
    const result = first.body.data.result;
    entry.intakeId = result.intakeId; entry.serverSha256 = result.checksumHex;
    check(`${source.alias}:server_hash`, result.checksumHex === source.digest);
    check(`${source.alias}:scan_pending`, result.status === 'scan_pending');
    assert(result.checksumHex === source.digest && result.status === 'scan_pending', 'UPLOAD_BINDING_MISMATCH');
    const replay = await upload(owner);
    entry.replayHttpStatus = replay.status; entry.replayErrorCode = safeCode(replay.body?.error?.code ?? 'none');
    check(`${source.alias}:upload_replay`, replay.status === 201 && replay.body.data?.replay === true && replay.body.data?.result?.intakeId === result.intakeId);
    // Storage read by diagnostic service identity only; no admin business mutations.
    const stored = await admin.storage.from('client-uploads').download(result.objectKey);
    assert(!stored.error && stored.data, 'STORAGE_READBACK_FAILED');
    entry.storageSha256 = sha(Buffer.from(await stored.data.arrayBuffer()));
    check(`${source.alias}:storage_hash`, entry.storageSha256 === source.digest);
    const review = await request(owner, `${route}/${result.intakeId}/review`, { method: 'POST',
      headers: { 'Idempotency-Key': `negative-review:${randomUUID()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accepted', reason: 'Disposable negative test: acceptance before scanner must be rejected' }) });
    entry.preScanReview = { httpStatus: review.status, code: safeCode(review.body?.error?.code ?? 'none') };
    check(`${source.alias}:unscanned_review_http_contract`, review.status === 409 && review.body?.error?.code === 'scope_conflict');
    assert(review.status >= 400, 'UNSCANNED_ACCEPTANCE_ALLOWED');
    const reviewRpc = await owner.client.schema('remhaos_integration_api').rpc('review_file_intake', {
      p_project_id: projectId, p_intake_id: result.intakeId, p_decision: 'accepted',
      p_reason: 'Disposable negative test only', p_idempotency_key: `negative-rpc:${randomUUID()}` });
    entry.reviewRpcGate = { code: safeCode(reviewRpc.error?.code ?? 'none'),
      cleanRequired: detailField(reviewRpc.error, 'reason') === 'CLEAN_SCAN_REQUIRED' };
    check(`${source.alias}:unscanned_review_rpc_gate`, entry.reviewRpcGate.code === 'P1209' && entry.reviewRpcGate.cleanRequired);
    assert(report.checks.at(-1).pass, 'SCAN_RPC_GATE_UNPROVEN');
    const publish = await request(owner, `${route}/${result.intakeId}/publish`, { method: 'POST',
      headers: { 'Idempotency-Key': `negative-publish:${randomUUID()}` } });
    entry.preScanPublish = { httpStatus: publish.status, code: safeCode(publish.body?.error?.code ?? 'none') };
    check(`${source.alias}:unscanned_publish_http_contract`, publish.status === 404 && publish.body?.error?.code === 'not_found');
    assert(publish.status >= 400, 'UNSCANNED_PUBLICATION_ALLOWED');
    const publishRpc = await owner.client.schema('remhaos_integration_api').rpc('get_file_intake_storage', {
      p_project_id: projectId, p_intake_id: result.intakeId });
    entry.publishRpcGate = { code: safeCode(publishRpc.error?.code ?? 'none'),
      missingPublishableIntake: detailField(publishRpc.error, 'entity') === 'publishable_file_intake' };
    check(`${source.alias}:unscanned_publish_rpc_gate`, entry.publishRpcGate.code === 'P1204' && entry.publishRpcGate.missingPublishableIntake);
    assert(report.checks.at(-1).pass, 'PUBLICATION_RPC_GATE_UNPROVEN');
    stage = 'bound-scan-request';
    const capability = randomBytes(32).toString('hex'), leaseSecret = randomBytes(32).toString('hex');
    const taskRequest = {projectId,intakeId:result.intakeId,capabilityDigest:sha(capability),idempotencyKey:`scan:${randomUUID()}`};
    const task = await requestBoundFileScan(owner.client,taskRequest);
    const taskReplay = await requestBoundFileScan(owner.client,taskRequest);
    check(`${source.alias}:scan_request_replay`,taskReplay.replay && taskReplay.result.taskId===task.result.taskId);
    const deniedClaim = await owner.client.schema('remhaos_integration_api').rpc('claim_bound_file_scan',{
      p_task:task.result.taskId,p_capability:capability,p_lease_digest:sha(leaseSecret),p_idempotency_key:'human-negative'});
    check(`${source.alias}:human_scan_completion_door_denied`,deniedClaim.error?.code==='42501');
    const wrongCap = await admin.schema('remhaos_integration_api').rpc('claim_bound_file_scan',{
      p_task:task.result.taskId,p_capability:randomBytes(32).toString('hex'),p_lease_digest:sha(leaseSecret),p_idempotency_key:'wrong-capability'});
    check(`${source.alias}:wrong_capability_denied`,wrongCap.error?.code==='P1103');
    let retained, claimed;
    const worker = new BoundFileScanWorker(admin,{
      ...disposableScanStorage(values.SERVICE_ROLE_KEY),executeScanner:async input=>{
        claimed=input.claim;
        entry.claimClockLeadMs=Date.parse(input.claim.claimedAt)-Date.now();save();
        return scanClaimedBytes(input);
      },
      retainEvidence:async evidence=>{
        const raw=JSON.stringify(evidence);writeFileSync(`${out}/scan-${sha(raw)}.json`,raw,{mode:0o600,flag:'wx'});retained=evidence;
      },
    });
    const executionInput = {taskId:task.result.taskId,capability,leaseSecret,claimKey:`claim:${randomUUID()}`,completionKey:`complete:${randomUUID()}`};
    stage = 'real-claimed-storage-scan';
    const completed = await worker.execute(executionInput);
    assert(retained && completed.result.outcome==='clean','CLAIMED_SCAN_NOT_CLEAN');
    const completionReplay = await worker.complete(executionInput,retained);
    check(`${source.alias}:bound_completion_replay`,completionReplay.replay && JSON.stringify(completed.result)===JSON.stringify(completionReplay.result));
    const changedEvidence = await admin.schema('remhaos_integration_api').rpc('complete_bound_file_scan',{
      p_task:task.result.taskId,p_capability:capability,p_attempt:retained.attempt,p_fence:retained.fence,p_lease_secret:leaseSecret,
      p_evidence:{...retained,sourceSha256:'0'.repeat(64)},p_idempotency_key:executionInput.completionKey});
    check(`${source.alias}:changed_completion_rejected`,changedEvidence.error?.code==='P1108');
    entry.scanCompletion = completed.result; entry.measuredScan = retained;
    report.scannerRun = true;
    stage = 'authenticated-child-source';
    assert(claimed,'CHILD_SOURCE_CLAIM_MISSING');
    const deniedUploadAuthorization=await outsider.client.schema('projectceo_api').rpc('authorize_source_upload',{
      project_id:projectId,package_id:packageId,checksum_hex:source.digest,media_type:source.mime,
      extension:source.alias.split('.').at(-1),size_bytes:source.bytes.length,source_role:source.sourceRole});
    check(`${source.alias}:outsider_child_source_denied`,deniedUploadAuthorization.error?.code==='P1103');
    let observation=0;
    const child=await registerBoundChildSource(owner.client,{projectId,packageId,physicalRecordId:randomUUID(),
      alias:source.alias,sourceRevisionId:`external-source-${source.digest.slice(0,24)}-r1`,key:`child:${randomUUID()}`,
      bytes:source.bytes,claim:claimed,evidence:retained,completion:completed.result,
      area:source.alias.endsWith('.pdf') ? {nodeId:'abian-documented-scope',revisionId:'abian-documented-scope-r1',
        title:'The Abian House documented scope',payload:{schemaVersion:'project-ceo/area/0.1',name:'The Abian House',
          floorAreaM2:652.1,sourceDate:'2025-09-20'}} : undefined,
      dependencyTargetNodeId:sourceIndex===2?decisionNodeId:undefined},{
      confirmCompletion:async evidence=>(await worker.complete(executionInput,evidence)).result,
      readCanonical:async(key,maxBytes)=>disposableScanStorage(values.SERVICE_ROLE_KEY).readObject('client-uploads',key,maxBytes),
      measureAnchor:async(bytes,kind)=>{
        const parserEnv={PATH:'/usr/bin:/bin:/opt/homebrew/bin',LANG:'C',LC_ALL:'C',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1'};
        if(kind==='pdf'){
          const parsed=spawnSync('/opt/homebrew/bin/pdfinfo',['-'],{env:parserEnv,input:bytes,encoding:'utf8',timeout:15000,maxBuffer:65536});
          const pages=Number(parsed.stdout?.match(/^Pages:\s+(\d+)$/m)?.[1]);
          assert(parsed.status===0&&Number.isSafeInteger(pages)&&pages>0,'PDF_PHYSICAL_PAGE_REQUIRED');
          entry.physicalPageCount=pages;
          return {sourceSha256:sha(bytes),method:'poppler-pdfinfo-page-count/1',locator:{kind:'pdf',page:1}};
        }
        if(kind==='image'){
          const imageBytes=Buffer.from(bytes);
          assert(imageBytes.length>24&&imageBytes.subarray(1,4).toString()==='PNG','PNG_PHYSICAL_IMAGE_REQUIRED');
          const width=imageBytes.readUInt32BE(16),height=imageBytes.readUInt32BE(20);
          assert(width>0&&height>0,'PNG_DIMENSIONS_REQUIRED');entry.imageDimensions={width,height};
          return {sourceSha256:sha(bytes),method:'png-ihdr-full-frame/1',locator:{kind:'image',coordinateSystem:'normalized',bbox:[0,0,1,1]}};
        }
        assert(kind==='spreadsheet','SOURCE_ANCHOR_KIND_UNSUPPORTED');
        const code='import sys,json,io,openpyxl; b=sys.stdin.buffer.read(); w=openpyxl.load_workbook(io.BytesIO(b),read_only=True,data_only=True); s=w["Offering BoQ"]; assert w["Drawing List"]["A1"].value=="The Abian House"; assert s["F49"].value==9781500; print(json.dumps({"sourceSha256":"'+sha(bytes)+'","method":"openpyxl-physical-cell/1","locator":{"kind":"spreadsheet","sheet":"Offering BoQ","cellRange":"F49"}}))';
        const parsed=spawnSync(join(userHome,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'),
          ['-c',code],{env:parserEnv,input:bytes,encoding:'utf8',timeout:15000,maxBuffer:65536});
        assert(parsed.status===0,'XLSX_PHYSICAL_PRICE_CELL_REQUIRED');
        return JSON.parse(parsed.stdout);
      },
      retainObservation:async value=>writeFileSync(`${out}/child-${source.digest}-${++observation}.json`,JSON.stringify(value),{mode:0o600,flag:'wx'}),
    });
    entry.childSource={sourceId:child.sourceId,sourceRevisionId:child.sourceRevisionId,checksum:child.checksum,packageId:child.packageId,
      fragmentId:child.fragmentId,evidenceLinkId:child.evidenceLinkId,areaEvidenceLinkId:child.areaEvidenceLinkId,anchor:child.anchor};
    check(`${source.alias}:child_scope_and_real_bytes`,child.packageId===packageId&&child.packageId!==projectId&&child.checksum===source.digest);
    check(`${source.alias}:original_unchanged`, sha(readFileSync(source.sourcePath)) === source.digest);
    save();
    if(sourceIndex===1){
      stage='authenticated-source-snapshot';
      const sourceSnapshotState=await projectState(owner,projectId);
      const snapshotArgs={project_id:projectId,expected_latest_version_id:null,expected_state_revision:sourceSnapshotState,
        label:'The Abian exact PDF and workbook source snapshot; content not approved',idempotency_key:`snapshot:${randomUUID()}`};
      const snapshot=await rpc(owner.client,'projectceo_api','publish_source_snapshot',snapshotArgs);
      const snapshotReplay=await rpc(owner.client,'projectceo_api','publish_source_snapshot',snapshotArgs);
      check('source_snapshot_replay',snapshotReplay.replay===true&&canonicalJson(snapshot.result)===canonicalJson(snapshotReplay.result));
      report.sourceSnapshot=snapshot;sourceSnapshotId=snapshot.result?.version?.id;
      assert(typeof sourceSnapshotId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(sourceSnapshotId),'SOURCE_SNAPSHOT_ID_INVALID');
      bootstrapDecisionRevisionId=randomUUID();
      await command(architect,projectId,'create_decision',{packageId,nodeId:decisionNodeId,revisionId:bootstrapDecisionRevisionId,
        expectedRevisionId:null,claimStatus:'human_origin',title:'The Abian source dependency anchor',
        resolution:'Disposable dependency anchor only. Source-bound content follows in the next immutable revision.',
        areaNodeId:null,decisionStatus:'proposed',evidence:[],reason:'Create the decision node after the source-only snapshot and before the image dependency edge.'},
      'create-dependency-anchor',false);
      stage='real-source-intake';
    }
  }
  stage='authenticated-source-snapshot';
  assert(sourceSnapshotId&&bootstrapDecisionRevisionId,'SOURCE_SNAPSHOT_OR_DECISION_ANCHOR_MISSING');
  report.childSourceBindings=sqlRead(`select coalesce(json_agg(json_build_object('sourceId',s.source_id,'checksum',encode(s.checksum,'hex'),
    'packageId',m.package_id,'sourceRevisionId',m.source_revision_id,'metadataPackageId',p.package_id,'sizeBytes',p.size_bytes,
    'documentStatus',p.document_status,'nodeKind',n.kind,
    'fragmentId',(select sf.fragment_id from project_intelligence.source_fragments sf
      where sf.organization_id=s.organization_id and sf.project_id=s.project_id and sf.source_id=s.source_id limit 1),
    'evidenceLinkId',(select el.evidence_link_id from project_intelligence.evidence_links el
      where el.organization_id=s.organization_id and el.project_id=s.project_id and el.node_revision_id=m.source_revision_id limit 1),
    'snapshotBound',exists(select 1 from project_intelligence.version_sources v
      join project_intelligence.version_nodes vn on vn.organization_id=v.organization_id and vn.project_id=v.project_id and vn.version_id=v.version_id
      where v.organization_id=s.organization_id and v.project_id=s.project_id and v.source_id=s.source_id and v.version_id='${sourceSnapshotId}'
        and vn.node_id=n.node_id and vn.revision_id=m.source_revision_id))), '[]'::json)
    from project_intelligence.sources s join projectceo_foundation.source_materializations m on m.organization_id=s.organization_id
    and m.project_id=s.project_id and m.logical_source_id=s.source_id and m.checksum=s.checksum
    join projectceo_foundation.source_protected_metadata p on p.organization_id=s.organization_id and p.project_id=s.project_id and p.source_id=s.source_id
    join project_intelligence.graph_node_revisions r on r.organization_id=s.organization_id and r.project_id=s.project_id and r.revision_id=m.source_revision_id
    join project_intelligence.graph_nodes n on n.organization_id=r.organization_id and n.project_id=r.project_id and n.node_id=r.node_id
    where s.project_id='${projectId}'::uuid`);
  check('exact_child_materialization',report.childSourceBindings.length===3&&report.sources.every(source=>report.childSourceBindings.some(b=>
    b.sourceId===source.childSource.sourceId&&b.sourceRevisionId===source.childSource.sourceRevisionId&&b.checksum===source.sourceSha256
    &&b.packageId===packageId&&b.metadataPackageId===packageId&&b.sizeBytes===source.byteLength&&b.documentStatus==='unknown'
    &&b.nodeKind==='source'&&b.snapshotBound===!source.alias.endsWith('.png')
    &&b.fragmentId===source.childSource.fragmentId&&b.evidenceLinkId===source.childSource.evidenceLinkId)));
  const listed = await request(owner, route);
  check('exact_three_clean_unapproved_rows', listed.status === 200 && Array.isArray(listed.body.data) && listed.body.data.length === 3 &&
    listed.body.data.every(r => r.status === 'clean' && r.scanOutcome === 'clean' && r.reviewDecision === null && r.sourceId === null));
  report.intakeAudit = sqlRead(`select coalesce(json_agg(json_build_object('intakeId', intake_id, 'eventType', event_type, 'actorType', actor_type, 'actorMatches', actor_user_id='${owner.userId}'::uuid, 'toStatus', to_status)), '[]'::json) from remhaos_integration.file_intake_events where project_id='${projectId}'::uuid`);
  const expectedEvents = { file_intake_requested: 'requested', file_uploaded_to_quarantine: 'uploaded_to_quarantine', file_scan_queued: 'scan_pending' };
  check('human_intake_audit', report.sources.length === 3 &&
    report.sources.every(source => {
      const events = report.intakeAudit.filter(r => r.intakeId === source.intakeId);
      return Object.entries(expectedEvents).every(([name, status]) =>
        events.filter(r => r.eventType === name && r.toStatus === status && r.actorType === 'human' && r.actorMatches).length === 1);
    }));
  check('system_completion_audit',report.sources.every(source=>['file_scan_completed','bound_file_scan_evidence_recorded'].every(name=>
    report.intakeAudit.filter(r=>r.intakeId===source.intakeId&&r.eventType===name&&r.actorType==='system'&&r.toStatus==='clean').length===1)));
  report.persistedEvidence=sqlRead(`select coalesce(json_agg(json_build_object('taskId',task_id,'receiptId',receipt_id,'evidenceDigest',encode(evidence_digest,'hex'),'evidence',evidence)),'[]'::json) from remhaos_integration.file_scan_evidence`);
  check('exact_persisted_evidence',report.persistedEvidence.length===3&&report.sources.every(source=>report.persistedEvidence.some(e=>
    e.receiptId===source.scanCompletion.receiptId&&e.evidenceDigest===source.scanCompletion.evidenceDigest&&e.evidence.sourceSha256===source.sourceSha256&&e.evidence.nonce===source.measuredScan.nonce)));

  const pdfSource=report.sources[0],priceSource=report.sources[1],photoSource=report.sources[2];
  const sourceEvidence=source=>({evidenceVersionId:sourceSnapshotId,evidenceLinkId:source.childSource.evidenceLinkId,
    sourceId:source.childSource.sourceId,sourceNodeId:`node-${source.childSource.sourceId}`,
    sourceRevisionId:source.childSource.sourceRevisionId,fragmentId:source.childSource.fragmentId});
  const areaNodeId='abian-documented-scope';
  const decisionRevisionId=randomUUID();
  stage='m2-source-bound-decision';
  await command(architect,projectId,'create_decision',{packageId,nodeId:decisionNodeId,
    revisionId:decisionRevisionId,expectedRevisionId:bootstrapDecisionRevisionId,claimStatus:'interpreted',title:'The Abian House documented plan set',
    resolution:'Use the supplied plan PDF and drawing register as the exact input set. Geometry is not inferred or approved by this disposable run.',
    areaNodeId,decisionStatus:'proposed',evidence:[sourceEvidence(pdfSource)],
    reason:'Operator-prepared disposable decision bound to the supplied plan PDF; not a client design approval.'},'create-decision',false);
  const selectionNodeId='abian-boq-offering';
  const selectionRevisionId=randomUUID();
  const convertedAmountRub=49560;
  stage='m2-source-bound-selection';
  await command(architect,projectId,'create_selection',{packageId,nodeId:selectionNodeId,revisionId:selectionRevisionId,
    expectedRevisionId:null,claimStatus:'extracted',title:'BoQ volume-calculation offering',areaNodeId,
    decisionRevisionId,specification:{originalCurrency:'IDR',originalAmount:'9781500',sourceCell:'Offering BoQ!F49',
      exchangeRate:'Bank of Russia 2025-09-20: 10000 IDR = 50.6670 RUB',convertedAmountRub:String(convertedAmountRub)},
    evidence:[sourceEvidence(priceSource)],reason:'Exact workbook value with explicit IDR origin and dated official conversion; Rp is not labelled as RUB.'},'create-selection',false);
  const priceObservation=await rpc(architect.client,'projectceo_product_api','append_price_observation',{
    project_id:projectId,selection_revision_id:selectionRevisionId,observation_id:`abian-boq-price-${randomUUID()}`,
    amount_rub:convertedAmountRub,evidence:sourceEvidence(priceSource),supplier_ref:'The Abian House workbook, Offering BoQ F49; CBR 2025-09-20',
    expected_state_revision:await projectState(architect,projectId),idempotency_key:`abian:price:${randomUUID()}`});
  assert(priceObservation?.result,'PRICE_OBSERVATION_FAILED');
  const approvalPackageId='abian-source-bound-approval';
  await command(owner,projectId,'create_approval_package',{packageId,approvalPackageId,items:[
    {targetKind:'decision_revision',entityId:decisionNodeId,revisionId:decisionRevisionId},
    {targetKind:'selection_revision',entityId:selectionNodeId,revisionId:selectionRevisionId}]},'create-approval',false);
  await command(owner,projectId,'submit_approval_package',{approvalPackageId,expectedStatus:'draft'},'submit-approval',false);
  await command(client,projectId,'review_selection',{approvalPackageId,expectedStatus:'submitted',decision:'approved',
    reason:'Disposable operator acceptance only; this is not a real client or commercial approval.'},'review-approval',false);

  const roles=['preferred','value_engineered','premium'];
  const variants=[];
  for (const role of roles) {
    const documentId=`abian-source-layout-${role}`,variantId=`abian-source-${role}`,revisionId=randomUUID();
    const layoutContent={contractVersion:'archidom.layout-document/0.1',documentId,projectId,
      name:`The Abian House source register — ${role}`,canonicalUnits:'mm',stateRevision:0,
      floor:{id:areaNodeId,label:'Documented package',elevationMm:0,clearHeightMm:1},
      variant:{id:variantId,label:`Disposable ${role}`,status:'published'},nodes:[],walls:[],openings:[],columns:[],objects:[],
      clearanceZones:[],materials:[],materialAssignments:[],lights:[],metadata:{sourceRefs:[pdfSource.childSource.sourceRevisionId,
        priceSource.childSource.sourceRevisionId],warnings:['Source-bound workflow proof only. No geometry was digitized or approved.']}};
    assert(validateLayoutDocument(layoutContent).valid,'LAYOUT_DOCUMENT_INVALID');
    const semantic=`sha256:${await semanticHash(layoutContent)}`;
    await command(owner,projectId,'publish_m2_layout_version',{packageId,documentId,versionId:`${documentId}-v1`,revisionId,
      expectedRevisionId:null,roomId:areaNodeId,variantId,role,semanticHash:semantic,schemaVersion:'project-ceo-m2-layout/0.1',
      layoutContent,reason:'Disposable source-bound publication; role labels do not assert distinct design facts.'},`layout-${role}`);
    variants.push({variantId,role,layoutDocumentId:documentId,layoutVersionId:`${documentId}-v1`,layoutRevisionId:revisionId,
      semanticHash:semantic,selectionRevisionIds:[selectionRevisionId],budget:{amountRub:convertedAmountRub,
        staleSelectionRevisionIds:[],missingPriceSelectionRevisionIds:[]}});
  }
  const submissionId='abian-m2-submission',submissionRevisionId=randomUUID(),reviewRevisionId=randomUUID();
  await command(owner,projectId,'submit_m2_client_review',{packageId,submissionId,revisionId:submissionRevisionId,
    expectedRevisionId:null,approvalPackageId,roomId:areaNodeId,designIntentRevisionId:decisionRevisionId,variants,
    budgetAsOf:new Date().toISOString(),staleAfterDays:3650,
    reason:'Disposable submission from real source facts; no production or customer commitment.'});
  await command(client,projectId,'review_m2_client_submission',{packageId,submissionId,revisionId:reviewRevisionId,
    expectedRevisionId:submissionRevisionId,chosenVariantId:variants[0].variantId,decision:'approved',
    reason:'Disposable operator workflow acceptance; not a real client approval.'});
  const handoffId='abian-m2-m3-handoff',handoffRevisionId=randomUUID();
  await command(owner,projectId,'publish_m2_m3_handoff',{packageId,handoffId,revisionId:handoffRevisionId,
    expectedRevisionId:null,approvedCommitId:`approved-${submissionId}`,approvedCommitRevisionId:reviewRevisionId,
    reason:'Exact disposable handoff of the source-bound approved commit to native M3.'});

  stage='native-m3-documentation';
  const sheetId='abian-pbg-plan',sheetRevision1='abian-pbg-plan-r1',sheetRevision2='abian-pbg-plan-r2';
  await command(architect,projectId,'register_documentation_sheet',{packageId,handoffId,handoffRevisionId,sheetId,
    sheetNumber:'PBG-5',title:'Gambar Rencana Denah Bangunan',revisionId:sheetRevision1,specificationRevisionIds:[],
    reason:'Registered from the exact scanned PBG plan PDF.'},'register-documentation-sheet',false);
  await command(architect,projectId,'attach_documentation_sheet_specifications',{packageId,sheetId,revisionId:sheetRevision2,
    expectedRevisionId:sheetRevision1,specificationRevisionIds:[selectionRevisionId],
    reason:'Attach the exact workbook-backed BoQ offering selection to the plan sheet.'},'attach-sheet-specifications',false);
  await publishFreshBaseline(owner,projectId,'BASELINE_B1');
  const nativePreview=await request(architect,`/api/projectceo/projects/${projectId}/packages/${packageId}/release-context`);
  assert(nativePreview.status===200&&nativePreview.body?.data?.context?.structurallyComplete===true,'NATIVE_M3_CONTEXT_INCOMPLETE');
  const confirmation=nativePreview.body.data.confirmation;assert(confirmation,'NATIVE_M3_CONFIRMATION_MISSING');
  const release=await command(architect,projectId,'publish_release',confirmation);
  const releaseVersion=release.first.result.productionPackageVersionId??release.first.result.versionId??release.first.result.id;
  assert(typeof releaseVersion==='string','NATIVE_M3_RELEASE_ID_MISSING');
  const releaseReplayBinding=sqlRead(`select json_build_object('count',count(*),'packageId',min(package_id::text),'digest',min(context_digest)) from projectceo_m3.production_package_native_contexts where project_id='${projectId}'::uuid and production_package_version_id='${releaseVersion.replaceAll("'","")}'`);
  check('native_m3_exact_context_once',releaseReplayBinding.count===1&&releaseReplayBinding.packageId===packageId&&releaseReplayBinding.digest===confirmation.snapshotToken);

  stage='release-artifact-worker';
  const worker=spawnSync('npm',['run','--silent','worker:release-artifacts'],{cwd,env,encoding:'utf8',timeout:300000,maxBuffer:1048576});
  assert(worker.status===0,'RELEASE_ARTIFACT_WORKER_FAILED');
  const workerLine=worker.stdout.trim().split('\n').at(-1);report.releaseArtifactWorker=JSON.parse(workerLine);
  assert(report.releaseArtifactWorker.scanned>=1,'RELEASE_ARTIFACT_MISSING');
  const distribution=await command(owner,projectId,'distribute_release',{productionPackageVersionId:releaseVersion,recipientUserId:builder.userId});
  const distributionId=distribution.first.result.distributionId;assert(distributionId,'DISTRIBUTION_ID_MISSING');
  await command(builder,projectId,'acknowledge_release',{distributionId});

  stage='m4-proposed-baseline';
  const revisedDecisionRevisionId=randomUUID();
  await command(architect,projectId,'create_decision',{packageId,nodeId:decisionNodeId,revisionId:revisedDecisionRevisionId,
    expectedRevisionId:decisionRevisionId,claimStatus:'extracted',title:'The Abian House drawing register revision 4.1',
    resolution:'Use the supplied Revised Position register dated 13 December 2025 as the later documented state. No cost or schedule effect is asserted.',
    areaNodeId,decisionStatus:'proposed',evidence:[sourceEvidence(priceSource)],
    reason:'Exact revision label and date from the supplied workbook; downstream impact remains subject to review.'},'create-revised-decision',false);
  const changeApprovalId='abian-revised-position-approval';
  await command(owner,projectId,'create_approval_package',{packageId,approvalPackageId:changeApprovalId,
    items:[{targetKind:'decision_revision',entityId:decisionNodeId,revisionId:revisedDecisionRevisionId}]},'create-change-approval',false);
  await command(owner,projectId,'submit_approval_package',{approvalPackageId:changeApprovalId,expectedStatus:'draft'},'submit-change-approval',false);
  await command(client,projectId,'review_selection',{approvalPackageId:changeApprovalId,expectedStatus:'submitted',decision:'approved',
    reason:'Disposable operator acceptance of source chronology only; not a construction or commercial approval.'},'review-change-approval',false);
  await publishFreshBaseline(owner,projectId,'BASELINE_B2');
  const change=await command(builder,projectId,'create_change',{reason:'Drawing register revision 3.1 to 4.1; cost and schedule deltas intentionally unknown.',
    fromProductionPackageVersionId:releaseVersion,deltaCostRub:0,deltaDays:0});
  const changeRequestId=change.first.result.id;assert(changeRequestId,'CHANGE_REQUEST_ID_MISSING');
  const impact=await rpc(admin,'projectceo_m4_api','calculate_change_impact_policy_bound',{project_id:projectId,
    change_request_id:changeRequestId,expected_state_revision:change.first.stateRevision,
    idempotency_key:`worker:abian-impact:${randomUUID()}`});
  assert(impact?.result?.impactCount>0&&impact.result.impacts?.length>0,'IMPACT_RESULT_EMPTY');
  report.impactCoverage={coverageStatus:impact.result.coverageStatus,returnedImpactCount:impact.result.returnedImpactCount,
    knownImpactCountLowerBound:impact.result.knownImpactCountLowerBound};save();
  assert(impact.result.coverageStatus==='complete','PARTIAL_IMPACT_MUST_NOT_REACH_ACCEPTANCE');
  for (const item of impact.result.impacts) {
    await command(owner,projectId,'review_change_impact',{impactRunId:impact.result.id,impactId:item.impactId,
      disposition:'resolved',reason:'Disposable review of the complete calculated impact set.'},`impact-${item.impactId}`);
  }

  stage='m4-site-evidence';
  const milestone=await rpc(owner.client,'projectceo_m4_api','define_milestone',{project_id:projectId,package_id:packageId,
    production_package_version_id:releaseVersion,title:'Site boundary reference reviewed',area_node_ids:[areaNodeId],
    expected_state_revision:await projectState(owner,projectId),idempotency_key:`abian:milestone:${randomUUID()}`});
  const milestoneId=milestone?.result?.id;assert(milestoneId,'MILESTONE_ID_MISSING');
  const suppliedFileTimestamp=new Date(statSync(selectedSources[2].sourcePath).mtimeMs).toISOString();
  const photoPayload={milestoneId,areaNodeId,
    sourceId:photoSource.childSource.sourceId,sourceRevisionId:photoSource.childSource.sourceRevisionId,
    capturedAt:suppliedFileTimestamp,note:'Supplied site-boundary image. capturedAt records the supplied file timestamp because camera EXIF is absent.'};
  const photoContract=projectCeoCommandSchema.safeParse({contractVersion:'projectceo-command/0.1',kind:'upload_photo_evidence',
    projectId,commandId:randomUUID(),payload:photoPayload});
  report.photoCommandValidation={success:photoContract.success,milestoneIdType:typeof milestoneId,
    milestoneIdUuid:typeof milestoneId==='string'&&/^[0-9a-f-]{36}$/.test(milestoneId),
    sourceIdPresent:typeof photoPayload.sourceId==='string',sourceRevisionIdPresent:typeof photoPayload.sourceRevisionId==='string',
    capturedAt:suppliedFileTimestamp,issues:photoContract.success?[]:photoContract.error.issues.map(issue=>({path:issue.path.join('.'),code:issue.code}))};save();
  assert(photoContract.success,'PHOTO_COMMAND_LOCAL_VALIDATION_FAILED');
  const photo=await command(builder,projectId,'upload_photo_evidence',photoPayload);
  const photoEvidenceId=photo.first.result.id;assert(photoEvidenceId,'PHOTO_EVIDENCE_ID_MISSING');
  const photoReview=await command(owner,projectId,'review_photo_evidence',{photoEvidenceId,decision:'accepted',
    reason:'Accepted only as a site-boundary reference for this disposable milestone; not proof of completed construction.'});
  const acceptance=await command(client,projectId,'accept_milestone',{milestoneId});
  const cardinality=sqlRead(`select json_build_object(
    'distributionRows',(select count(*) from projectceo_product.release_distributions where distribution_id='${distributionId}'::uuid),
    'ackRows',(select count(*) from projectceo_product.release_acknowledgements where distribution_id='${distributionId}'::uuid),
    'changeRows',(select count(*) from projectceo_m4.change_requests where change_request_id='${changeRequestId}'::uuid),
    'impactRows',(select count(*) from projectceo_m4.impacts where impact_run_id='${impact.result.id}'::uuid),
    'impactReviewRows',(select count(*) from projectceo_m4.impact_reviews where impact_run_id='${impact.result.id}'::uuid),
    'photoRows',(select count(*) from projectceo_m4.photo_evidence where photo_evidence_id='${photoEvidenceId}'::uuid),
    'photoReviewRows',(select count(*) from projectceo_m4.photo_evidence_reviews where photo_evidence_id='${photoEvidenceId}'::uuid),
    'acceptanceRows',(select count(*) from projectceo_m4.milestone_acceptances where milestone_id='${milestoneId}'::uuid))`);
  check('m4_exact_cardinality',cardinality.distributionRows===1&&cardinality.ackRows===1&&cardinality.changeRows===1
    &&cardinality.impactRows>0&&cardinality.impactReviewRows===cardinality.impactRows&&cardinality.photoRows===1
    &&cardinality.photoReviewRows===1&&cardinality.acceptanceRows===1);

  report.chain={decision:{nodeId:decisionNodeId,revisionId:decisionRevisionId},selection:{nodeId:selectionNodeId,
    revisionId:selectionRevisionId,originalCurrency:'IDR',originalAmount:9781500,convertedAmountRub,
    rate:{date:'2025-09-20',nominalIdr:10000,rub:50.667}},handoff:{id:handoffId,revisionId:handoffRevisionId},
    baselineId:confirmation.expectedBaselineId,releaseVersion,distributionId,changeRequestId,impactRunId:impact.result.id,
    milestoneId,photoEvidenceId,photoReviewId:photoReview.first.result.id,acceptanceId:acceptance.first.result.id,
    sessions:{owner:owner.sessionId,architect:architect.sessionId,builder:builder.sessionId,client:client.sessionId}};
  report.fullExternalE2E=true;
  report.status = report.checks.every(c => c.pass) ? (fastDiagnostic
    ? 'WP32_EXTERNAL_AUTHENTICATED_DIAGNOSTIC_PASS' : 'WP32_EXTERNAL_AUTHENTICATED_RUNTIME_PASS') : 'RUNTIME_CHECK_FAILURE';
  report.remaining = 'FINALIZER_CYCLE7_AND_FINAL_SHA_REVIEW_PENDING';
} catch (error) {
  report.status = 'failed'; report.failure = { stage, code: safeCode(error.code ?? error.message),
    sqlstate:safeCode(error.sqlstate ?? 'none'),reason:safeCode(error.reason ?? 'none'),name:safeCode(error.name ?? 'none') };
  console.error(`ARCHITECT_INTAKE_FAILED stage=${stage} code=${safeCode(error.message)}`); process.exitCode = 1;
} finally {
  for (const source of selectedSources) {
    try { check(`${source.alias}:final_original_unchanged`, sha(readFileSync(source.sourcePath)) === source.digest); }
    catch { check(`${source.alias}:final_original_unchanged`, false, { code: 'SOURCE_RECHECK_FAILED' }); }
  }
  if (app && app.exitCode === null) {
    const exited = new Promise(resolve => app.once('exit', resolve)); app.kill('SIGTERM');
    await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]);
    if (app.exitCode === null) { app.kill('SIGKILL'); await exited; }
  }
  rmSync(`${out}/app.log`, { force: true });
  if (started) {
    stage = 'dispose'; try { run('zsh', ['tests/ap1/environment/run-local.zsh', 'dispose']); report.disposed = true; }
    catch { report.disposed = false; process.exitCode = 1; }
  }
  const remaining = spawnSync('docker', ['ps', '-aq'], { env, encoding: 'utf8', timeout: 30000 });
  report.emptyDisposableDocker = remaining.status === 0 && !remaining.stdout.trim();
  if (started && (!report.disposed || !report.emptyDisposableDocker)) {
    report.status = 'CLEANUP_UNCONFIRMED'; process.exitCode = 1;
  } else if (report.checks.some(c => !c.pass)) {
    if (report.status !== 'failed') report.status = 'INTAKE_CHECK_FAILURE';
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(`ARCHITECT_INTAKE_RESULT=${report.status}`);
  console.log(`ARCHITECT_INTAKE_EVIDENCE=${out}/evidence.json`);
}
