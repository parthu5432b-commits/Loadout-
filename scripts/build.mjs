import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const fail = message => { console.error(`\nBUILD STOPPED: ${message}`); process.exit(1); };
function run(command, args, cwd = ROOT) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
}
function walk(dir) {
  const out=[];
  for (const item of fs.readdirSync(dir, {withFileTypes:true})) {
    const p=path.join(dir,item.name);
    if (item.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

const planPath = path.join(ROOT, 'BUILD_PLAN.json');
if (!fs.existsSync(planPath)) fail('BUILD_PLAN.json is missing. Upload the complete repository root, not only the payload ZIP.');
const plan = readJson(planPath);
if (plan.formatVersion !== 1) fail('Unsupported BUILD_PLAN format.');
const payloadPath = path.join(ROOT, plan.payload);
const sumsPath = path.join(ROOT, plan.payloadSha256File);
if (!fs.existsSync(payloadPath) || !fs.existsSync(sumsPath)) fail('Payload ZIP or SHA256SUMS.txt is missing.');
const expected = fs.readFileSync(sumsPath, 'utf8').trim().split(/\s+/)[0].toLowerCase();
const actual = crypto.createHash('sha256').update(fs.readFileSync(payloadPath)).digest('hex');
if (actual !== expected) fail('Payload SHA-256 mismatch. Do not build a modified or truncated payload.');

const workspace = path.join(ROOT, plan.workspace);
fs.rmSync(workspace, { recursive:true, force:true });
fs.mkdirSync(workspace, { recursive:true });
run('unzip', ['-q', payloadPath, '-d', workspace]);
const appDir = path.join(workspace, 'loadout-app');
const deepInstructionsPath = path.join(appDir, plan.instructionFile);
if (!fs.existsSync(deepInstructionsPath)) fail('Inner BUILD_INSTRUCTIONS.json was not found after extraction.');
const instructions = readJson(deepInstructionsPath);
if (instructions.schemaVersion !== 1) fail('Unsupported inner build-instruction schema.');
if (instructions.app?.appId !== plan.expectedAppId) fail('Inner instructions target a different appId.');
if (instructions.app?.webDir !== plan.expectedWebDir) fail('Inner instructions use an unexpected webDir.');
for (const required of ['package.json','capacitor.config.json','www/index.html','www/app.js',instructions.native?.source]) {
  if (!fs.existsSync(path.join(appDir, required))) fail(`Required payload file missing: ${required}`);
}
const cap = readJson(path.join(appDir, 'capacitor.config.json'));
if (cap.appId !== instructions.app.appId || cap.webDir !== instructions.app.webDir) fail('capacitor.config.json does not match the deep instructions.');

console.log('\nDeep instructions loaded:');
console.log(JSON.stringify({ app:instructions.app, runtime:instructions.runtime, native:instructions.native, safety:instructions.safety, build:instructions.build }, null, 2));

run('npm', ['install','--no-audit','--no-fund'], appDir);
run('npx', ['cap','add','android'], appDir);

// Attach the native plugin to the generated Capacitor Android host.
const androidRoot = path.join(appDir, 'android');
const javaFiles = walk(path.join(androidRoot, 'app', 'src', 'main', 'java')).filter(p => path.basename(p) === 'MainActivity.java');
if (javaFiles.length !== 1) fail(`Expected one MainActivity.java, found ${javaFiles.length}.`);
const mainActivityPath = javaFiles[0];
let mainActivity = fs.readFileSync(mainActivityPath, 'utf8');
const packageMatch = mainActivity.match(/^\s*package\s+([A-Za-z0-9_.]+)\s*;/m);
if (!packageMatch) fail('Could not detect MainActivity Java package.');
const javaPackage = packageMatch[1];
const nativeSourceDir = path.join(appDir, instructions.native.sourceDir || path.dirname(instructions.native.source));
const nativeSources = walk(nativeSourceDir).filter(p => p.endsWith('.java'));
if (!nativeSources.some(p => path.basename(p) === `${instructions.native.pluginClass}.java`)) fail('Native plugin source is missing from native source directory.');
for (const sourcePath of nativeSources) {
  const template = fs.readFileSync(sourcePath, 'utf8');
  const source = template.replace('package __PACKAGE__;', `package ${javaPackage};`);
  const destination = path.join(path.dirname(mainActivityPath), path.basename(sourcePath));
  fs.writeFileSync(destination, source);
}
const importLine = `import ${javaPackage}.${instructions.native.pluginClass};`;
if (!mainActivity.includes(importLine)) {
  mainActivity = mainActivity.replace(packageMatch[0], `${packageMatch[0]}\n\n${importLine}`);
}
if (!mainActivity.includes('import android.os.Bundle;')) {
  mainActivity = mainActivity.replace(packageMatch[0], `${packageMatch[0]}\n\nimport android.os.Bundle;`);
}
if (!mainActivity.includes(`registerPlugin(${instructions.native.pluginClass}.class);`)) {
  const onCreate = /((?:public|protected)\s+void\s+onCreate\s*\(\s*Bundle\s+savedInstanceState\s*\)\s*\{)/;
  if (onCreate.test(mainActivity)) {
    mainActivity = mainActivity.replace(onCreate, `$1\n        registerPlugin(${instructions.native.pluginClass}.class);`);
  } else {
    const classOpen = /public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{/;
    if (!classOpen.test(mainActivity)) fail('Could not locate MainActivity class to register the native plugin.');
    mainActivity = mainActivity.replace(classOpen, `$&\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(${instructions.native.pluginClass}.class);\n        super.onCreate(savedInstanceState);\n    }`);
  }
}
mainActivity = mainActivity.replace(/\n    \}\}/g, '\n    }\n}');
fs.writeFileSync(mainActivityPath, mainActivity);

// Version identity is read from the deep build instructions so release policy stays outside the APK.
const appGradlePath = path.join(androidRoot, 'app', 'build.gradle');
const versionCode = Number(instructions.build.versionCode);
const versionName = String(instructions.build.versionName || '');
if (!Number.isInteger(versionCode) || versionCode < 1 || !/^\d+\.\d+\.\d+$/.test(versionName)) fail('Invalid Android versionCode/versionName in deep instructions.');
if (!fs.existsSync(appGradlePath)) fail('Generated Android app/build.gradle is missing; cannot set the requested app version.');
{
  let gradleText = fs.readFileSync(appGradlePath, 'utf8');
  if (!/versionCode\s*=?\s*\d+/.test(gradleText) || !/versionName\s*=?\s*['\"][^'\"]+['\"]/.test(gradleText)) fail('Could not locate Android versionCode/versionName fields in generated Gradle file.');
  gradleText = gradleText.replace(/versionCode\s*=?\s*\d+/, `versionCode ${versionCode}`);
  gradleText = gradleText.replace(/versionName\s*=?\s*['\"][^'\"]+['\"]/, `versionName \"${versionName}\"`);
  fs.writeFileSync(appGradlePath, gradleText);
}

run('npx', ['cap','sync','android'], appDir);
const gradlew = path.join(androidRoot, 'gradlew');
if (!fs.existsSync(gradlew)) fail('Gradle wrapper missing after Capacitor Android generation.');
fs.chmodSync(gradlew, 0o755);
run('./gradlew', [instructions.build.gradleTask, '--no-daemon', '--stacktrace'], androidRoot);

const apkDir = path.join(androidRoot, 'app', 'build', 'outputs', 'apk', 'debug');
const apks = fs.existsSync(apkDir) ? fs.readdirSync(apkDir).filter(name => name.endsWith('.apk')) : [];
if (!apks.length) fail('Gradle completed but no debug APK was found.');
const apk = path.join(apkDir, apks[0]);
const buildInfo = {
  appId: instructions.app.appId,
  appName: instructions.app.appName,
  versionName: instructions.build.versionName,
  versionCode: instructions.build.versionCode,
  runtime: instructions.runtime,
  nativePlugin: instructions.native.pluginName,
  apk: path.relative(appDir, apk),
  apkBytes: fs.statSync(apk).size,
  payloadSha256: actual,
  gitCommit: process.env.GITHUB_SHA || 'local',
  builtAt: new Date().toISOString(),
  note: 'Build-side YAML, scripts and architecture documentation are outside the Capacitor webDir and are not copied as web assets into the APK.'
};
fs.writeFileSync(path.join(appDir, 'BUILD_INFO.json'), JSON.stringify(buildInfo, null, 2) + '\n');
console.log('\nBUILD COMPLETE');
console.log(JSON.stringify(buildInfo, null, 2));
