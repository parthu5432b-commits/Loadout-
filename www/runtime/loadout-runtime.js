/* Loadout Self-Evolving Runtime — foundation v0.1.0
 * Loaded before the legacy app. Deliberately adds no UI and does not rewrite existing data.
 * Native calls are capability-limited by the LoadoutCore Capacitor plugin.
 */
(function (global) {
  'use strict';
  if (global.Loadout) return;

  const VERSION = '0.1.0';
  const RUNTIME_API = '1.0.0';
  const APP_ID = 'app.loadout.jee';
  const PREFIX = 'loadout.runtime.v1.';
  const memoryStores = new Map();
  const loadedModules = new Map();
  const listeners = new Map();
  const native = (() => {
    const cap = global.Capacitor;
    if (!cap) return null;
    const existing = cap.Plugins && (cap.Plugins.LoadoutCore || cap.Plugins.LoadoutNativeCore);
    if (existing) return existing;
    const available = typeof cap.isPluginAvailable === 'function' && cap.isPluginAvailable('LoadoutCore');
    return (available && typeof cap.registerPlugin === 'function' ? cap.registerPlugin('LoadoutCore') : null) || global.LoadoutCore || null;
  })();

  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const safeId = value => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(String(value || ''));
  const safePath = value => {
    const s = String(value || '');
    return !!s && !s.startsWith('/') && !s.includes('\\') && !s.split('/').some(x => !x || x === '.' || x === '..') && /^[a-zA-Z0-9._/-]+$/.test(s);
  };
  const slug = value => String(value).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 90);
  const moduleBundleKey = mod => 'bundle_' + slug(String(mod.id) + '__' + String(mod.version));

  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text));
    if (global.crypto && global.crypto.subtle) {
      const digest = await global.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    throw new Error('SHA-256 is unavailable in this WebView; update package rejected.');
  }

  async function nativeRead(namespace, key) {
    if (!native || typeof native.readPrivateFile !== 'function') return null;
    try { const result = await native.readPrivateFile({ namespace, key }); return result && result.value != null ? result.value : null; }
    catch (error) { throw new Error('Native storage read failed: ' + (error.message || error)); }
  }
  async function nativeWrite(namespace, key, value) {
    if (!native || typeof native.writePrivateFile !== 'function') return false;
    const result = await native.writePrivateFile({ namespace, key, value: String(value) });
    if (result && result.ok === false) throw new Error(result.error || 'Native storage write failed');
    return true;
  }
  async function nativeDelete(namespace, key) {
    if (!native || typeof native.deletePrivateFile !== 'function') return false;
    await native.deletePrivateFile({ namespace, key }); return true;
  }

  function redact(value) {
    const copy = clone(value || {});
    const secretKeys = /key|token|secret|password|authorization|credential/i;
    function walk(v) {
      if (Array.isArray(v)) return v.map(walk);
      if (!v || typeof v !== 'object') return v;
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = secretKeys.test(k) ? '[REDACTED]' : walk(x);
      return out;
    }
    return walk(copy);
  }

  const Diagnostics = {
    policy: 'balanced',
    async record(level, event, details) {
      if (!['error', 'warn', 'update', 'recovery'].includes(level)) return;
      const record = { at: new Date().toISOString(), level, event: String(event || 'event').slice(0, 100), details: redact(details) };
      try {
        let rows = [];
        const raw = await nativeRead('diagnostics', 'events.json');
        if (raw) { try { rows = JSON.parse(raw); } catch (_) { rows = []; } }
        if (!Array.isArray(rows)) rows = [];
        rows.push(record);
        rows = rows.slice(-500);
        let json = JSON.stringify(rows);
        while (json.length > 1500000 && rows.length > 1) { rows.shift(); json = JSON.stringify(rows); }
        if (json.length > 1500000) json = JSON.stringify([{ at: record.at, level, event: record.event, details: { truncated: true } }]);
        if (!(await nativeWrite('diagnostics', 'events.json', json))) localStorage.setItem(PREFIX + 'diagnostics', json);
      } catch (e) {
        try {
          const raw = localStorage.getItem(PREFIX + 'diagnostics');
          const rows = raw ? JSON.parse(raw) : [];
          rows.push(record);
          localStorage.setItem(PREFIX + 'diagnostics', JSON.stringify(rows.slice(-300)));
        } catch (_) { /* diagnostics must never break the app */ }
      }
    },
    async read() {
      try {
        const raw = await nativeRead('diagnostics', 'events.json') || localStorage.getItem(PREFIX + 'diagnostics');
        const rows = raw ? JSON.parse(raw) : [];
        return Array.isArray(rows) ? rows : [];
      } catch (_) { return []; }
    },
    async clear() {
      try { await nativeDelete('diagnostics', 'events.json'); } catch (_) {}
      try { localStorage.removeItem(PREFIX + 'diagnostics'); } catch (_) {}
    }
  };

  function storageKey(namespace, name) { return PREFIX + slug(namespace) + '.' + slug(name); }
  const Storage = {
    async create(options) {
      const opts = Object.assign({ namespace: 'default', name: 'store', lifetime: 'persistent' }, options || {});
      if (!safeId(opts.namespace) || !safeId(opts.name)) throw new Error('Storage namespace/name must be safe identifiers.');
      if (!['volatile', 'session', 'module', 'ttl', 'persistent'].includes(opts.lifetime)) throw new Error('Unsupported storage lifetime: ' + opts.lifetime);
      if (opts.lifetime === 'ttl' && !(Number(opts.ttlMs) > 0)) throw new Error('ttl lifetime requires ttlMs > 0.');
      if (opts.moduleId && !safeId(opts.moduleId)) throw new Error('moduleId must be a safe identifier.');
      const id = opts.lifetime === 'module' ? (opts.moduleId || opts.namespace) + ':' + opts.namespace + ':' + opts.name : opts.namespace + ':' + opts.name;
      let map;
      if (opts.lifetime === 'volatile' || opts.lifetime === 'module') {
        if (!memoryStores.has(id)) memoryStores.set(id, new Map());
        map = memoryStores.get(id);
      }
      const modId = opts.moduleId || opts.namespace;
      const sessionName = storageKey(opts.namespace, opts.name);
      async function readRaw() {
        if (map) return map.has('value') ? JSON.stringify(map.get('value')) : null;
        if (opts.lifetime === 'session') return sessionStorage.getItem(sessionName);
        if (opts.lifetime === 'persistent' || opts.lifetime === 'ttl') {
          const raw = await nativeRead(opts.namespace, opts.name);
          return raw !== null ? raw : localStorage.getItem(sessionName);
        }
        return null;
      }
      async function writeRaw(raw) {
        if (map) { map.set('value', JSON.parse(raw)); return; }
        if (opts.lifetime === 'session') { sessionStorage.setItem(sessionName, raw); return; }
        if (opts.lifetime === 'persistent' || opts.lifetime === 'ttl') {
          if (!(await nativeWrite(opts.namespace, opts.name, raw))) localStorage.setItem(sessionName, raw);
        }
      }
      async function removeRaw() {
        if (map) { map.delete('value'); return; }
        if (opts.lifetime === 'session') { sessionStorage.removeItem(sessionName); return; }
        if (opts.lifetime === 'persistent' || opts.lifetime === 'ttl') {
          await nativeDelete(opts.namespace, opts.name);
          localStorage.removeItem(sessionName);
        }
      }
      return Object.freeze({
        lifetime: opts.lifetime,
        async get() {
          const raw = await readRaw(); if (raw == null) return null;
          try {
            const item = JSON.parse(raw);
            if (opts.lifetime === 'ttl' && item && item.expiresAt && Date.now() >= item.expiresAt) { await removeRaw(); return null; }
            return item && Object.prototype.hasOwnProperty.call(item, 'value') ? item.value : item;
          } catch (_) { await removeRaw(); return null; }
        },
        async set(value) {
          const item = opts.lifetime === 'ttl' ? { value, expiresAt: Date.now() + Number(opts.ttlMs) } : { value };
          await writeRaw(JSON.stringify(item));
          return true;
        },
        async delete() { await removeRaw(); },
        async clear() { await removeRaw(); }
      });
    },
    deactivateModule(moduleId) {
      const prefix = String(moduleId) + ':';
      for (const [key, map] of [...memoryStores.entries()]) if (key.startsWith(prefix)) { map.clear(); memoryStores.delete(key); }
    }
  };

  const Events = {
    on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
      return () => listeners.get(name)?.delete(callback);
    },
    emit(name, payload) {
      for (const callback of listeners.get(name) || []) {
        try { callback(payload); } catch (e) { Diagnostics.record('warn', 'event-listener-failed', { name, message: e.message }); }
      }
    }
  };

  // Managed update state is deliberately isolated from the legacy JEE data keys.
  async function readManaged(key, fallback) {
    try {
      const raw = await nativeRead('runtime', key) || localStorage.getItem(storageKey('runtime', key));
      return raw ? JSON.parse(raw) : clone(fallback);
    } catch (_) { return clone(fallback); }
  }
  async function writeManaged(key, value) {
    const raw = JSON.stringify(value);
    if (!(await nativeWrite('runtime', key, raw))) localStorage.setItem(storageKey('runtime', key), raw);
  }
  async function deleteManaged(key) {
    await nativeDelete('runtime', key); localStorage.removeItem(storageKey('runtime', key));
  }

  function pointerParts(pointer) {
    if (pointer === '' || pointer === '/') return [];
    if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new Error('JSON pointer must start with /.');
    return pointer.slice(1).split('/').map(x => x.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  function getAt(root, pointer) {
    let node = root;
    for (const part of pointerParts(pointer)) { if (node == null || !Object.prototype.hasOwnProperty.call(node, part)) return undefined; node = node[part]; }
    return node;
  }
  function parentAt(root, pointer) {
    const parts = pointerParts(pointer); if (!parts.length) throw new Error('Root mutation is not allowed.');
    const key = parts.pop(); let node = root;
    for (const part of parts) { if (!node || typeof node !== 'object' || !(part in node)) throw new Error('Path does not exist: ' + pointer); node = node[part]; }
    return { node, key };
  }
  function applyJsonOp(state, op) {
    const kind = String(op.op || '').toUpperCase();
    if (['ADD', 'REPLACE', 'REMOVE', 'PATCH', 'RECONFIGURE', 'CHANGE_POLICY'].includes(kind)) {
      const path = kind === 'RECONFIGURE' ? '/settings' + (op.path || '') : kind === 'CHANGE_POLICY' ? '/policies' + (op.path || '') : op.path;
      const { node, key } = parentAt(state, path);
      if (kind === 'REMOVE' || (kind === 'PATCH' && op.action === 'remove')) {
        if (Array.isArray(node)) node.splice(Number(key), 1); else delete node[key];
      } else if (kind === 'PATCH' && op.action === 'append') {
        if (!Array.isArray(node[key])) throw new Error('PATCH append target must be an array.'); node[key].push(clone(op.value));
      } else {
        if (kind === 'REPLACE' && !(key in node)) throw new Error('REPLACE target does not exist: ' + path);
        if (kind === 'PATCH' && op.action !== 'set') throw new Error('PATCH action must be set, append or remove.');
        node[key] = clone(op.value);
      }
      return;
    }
    if (kind === 'RENAME' || kind === 'MOVE') {
      const from = parentAt(state, op.from), to = parentAt(state, op.to);
      if (!(from.key in from.node)) throw new Error('Source path missing: ' + op.from);
      if (to.key in to.node) throw new Error('Destination already exists: ' + op.to);
      to.node[to.key] = from.node[from.key]; delete from.node[from.key]; return;
    }
    if (kind === 'MIGRATE') {
      if (!Array.isArray(op.steps)) throw new Error('MIGRATE needs a steps array.');
      op.steps.forEach(step => applyJsonOp(state, step)); return;
    }
    if (kind === 'INSTALL_DEPENDENCY' || kind === 'REMOVE_DEPENDENCY') {
      state.dependencies = state.dependencies || {};
      if (kind === 'INSTALL_DEPENDENCY') state.dependencies[op.id] = String(op.version || '*'); else delete state.dependencies[op.id];
      return;
    }
    if (kind === 'VALIDATE' || kind === 'ACTIVATE') return;
    throw new Error('Unsupported transformation operation: ' + kind);
  }

  async function doSourcePatch(files, op) {
    if (!safePath(op.file) || !/^(modules|extensions\/web)\/.+\.m?js$/i.test(op.file)) throw new Error('PATCH_SOURCE is limited to JS files under modules/ or extensions/web/.');
    const current = files[op.file];
    if (typeof current !== 'string') throw new Error('PATCH_SOURCE target is not in staged files: ' + op.file);
    if (typeof op.anchor !== 'string' || !op.anchor.length || typeof op.replacement !== 'string') throw new Error('PATCH_SOURCE requires exact anchor and replacement strings.');
    if (!op.expectedSha256 || (await sha256(current)).toLowerCase() !== String(op.expectedSha256).toLowerCase()) throw new Error('PATCH_SOURCE precondition hash mismatch: ' + op.file);
    let count = 0, at = -1, searchFrom = 0;
    while ((at = current.indexOf(op.anchor, searchFrom)) !== -1) { count++; searchFrom = at + op.anchor.length; }
    const expected = Number(op.expectedOccurrences || 1);
    if (count !== expected) throw new Error('PATCH_SOURCE expected ' + expected + ' match(es), found ' + count + '.');
    files[op.file] = current.split(op.anchor).join(op.replacement);
    if (op.resultSha256 && (await sha256(files[op.file])).toLowerCase() !== String(op.resultSha256).toLowerCase()) throw new Error('PATCH_SOURCE result hash mismatch: ' + op.file);
  }

  async function activateCode(mod, file, api) {
    const blob = new Blob([file], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      const module = await import(url);
      const activate = module.activate || module.install || module.default;
      let dispose = null;
      if (typeof activate === 'function') dispose = await activate(api);
      if (dispose && typeof dispose !== 'function' && typeof dispose.dispose === 'function') {
        const disposable = dispose;
        dispose = () => disposable.dispose();
      }
      const cleanup = typeof dispose === 'function' ? dispose : (typeof module.deactivate === 'function' ? () => module.deactivate(api) : null);
      return async () => {
        try { if (typeof cleanup === 'function') await cleanup(); }
        finally { Storage.deactivateModule(mod.id); }
      };
    } finally { setTimeout(() => URL.revokeObjectURL(url), 60000); }
  }

  const Updates = {
    async stage(pkg) {
      if (!pkg || !pkg.manifest || !pkg.files || typeof pkg.files !== 'object') throw new Error('Update package requires manifest and files.');
      const m = pkg.manifest;
      if (m.formatVersion !== '1.0' || !m.updateId || !m.target || m.target.appId !== APP_ID) throw new Error('Unsupported package or wrong target app.');
      if (m.runtimeApi && m.runtimeApi !== RUNTIME_API) throw new Error('Runtime API mismatch.');
      if (!Array.isArray(m.modules) || !Array.isArray(m.transformations || [])) throw new Error('Invalid manifest shape.');
      const files = clone(pkg.files);
      let totalBytes = 0;
      for (const [name, content] of Object.entries(files)) {
        if (!safePath(name) || typeof content !== 'string') throw new Error('Unsafe file path or non-text source in package: ' + name);
        const size = new TextEncoder().encode(content).length;
        if (size > 4 * 1024 * 1024) throw new Error('Individual module exceeds 4 MiB: ' + name);
        totalBytes += size;
      }
      if (totalBytes > 8 * 1024 * 1024) throw new Error('Staged update source exceeds the 8 MiB transaction limit.');
      for (const mod of m.modules) {
        if (!safeId(mod.id) || !safePath(mod.entry) || typeof files[mod.entry] !== 'string' || !mod.sha256) throw new Error('Module descriptor invalid: ' + (mod && mod.id));
        if (mod.runtimeApi && mod.runtimeApi !== RUNTIME_API) throw new Error('Module runtime API mismatch: ' + mod.id);
        if ((await sha256(files[mod.entry])).toLowerCase() !== String(mod.sha256).toLowerCase()) throw new Error('Module integrity mismatch: ' + mod.id);
      }
      const config = await readManaged('config', { settings: {}, policies: {}, dependencies: {} });
      const candidateConfig = clone(config);
      for (const op of (m.transformations || [])) {
        if (String(op.op || '').toUpperCase() === 'PATCH_SOURCE') await doSourcePatch(files, op);
        else applyJsonOp(candidateConfig, op);
      }
      for (const mod of m.modules) mod.sha256 = await sha256(files[mod.entry]);
      const txId = 'tx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      const previousRegistry = await readManaged('active-modules', {});
      const tx = {
        id: txId, updateId: m.updateId, targetVersion: String(m.target.version || ''),
        state: 'awaiting-manual-decision', createdAt: new Date().toISOString(),
        manifest: clone(m), files, previousRegistry, previousConfig: config,
        candidateConfig, candidateRegistry: clone(previousRegistry),
        decision: null, validation: { passed: true, checks: ['manifest', 'app-target', 'runtime-api', 'module-hashes', 'transformation-preconditions'] }
      };
      for (const mod of m.modules) tx.candidateRegistry[mod.id] = { id: mod.id, version: String(mod.version), entry: mod.entry, sha256: mod.sha256, sourceKey: moduleBundleKey(mod) };
      await writeManaged('transaction-' + txId, tx);
      const index = await readManaged('transaction-index', []); if (!index.includes(txId)) { index.push(txId); await writeManaged('transaction-index', index.slice(-100)); }
      await Diagnostics.record('update', 'update-staged', { txId, updateId: m.updateId, moduleCount: m.modules.length, transformationCount: (m.transformations || []).length });
      return { transactionId: txId, state: tx.state, requiresManualDecision: true, validation: tx.validation };
    },
    async inspect(txId) { if (!safeId(txId)) throw new Error('Invalid transaction ID.'); return readManaged('transaction-' + txId, null); },
    async pending() {
      const index = await readManaged('transaction-index', []);
      const out = [];
      for (const id of index) { const tx = await readManaged('transaction-' + id, null); if (tx && tx.state === 'awaiting-manual-decision') out.push({ id, updateId: tx.updateId, createdAt: tx.createdAt }); }
      return out;
    },
    async commit(txId) {
      if (!safeId(txId)) throw new Error('Invalid transaction ID.');
      const tx = await readManaged('transaction-' + txId, null);
      if (!tx || tx.state !== 'awaiting-manual-decision') throw new Error('Transaction is not awaiting a manual decision.');
      const api = Object.freeze({ version: VERSION, runtimeApi: RUNTIME_API, storage: Storage, events: Events, diagnostics: Diagnostics });
      for (const [id, current] of loadedModules) { try { if (typeof current.dispose === 'function') await current.dispose(); } catch (e) { await Diagnostics.record('warn', 'module-dispose-error', { id, message: e.message }); } }
      loadedModules.clear();
      try {
        for (const mod of tx.manifest.modules) {
          const source = tx.files[mod.entry];
          const key = moduleBundleKey(mod);
          if (!(await nativeWrite('module-bundles', key, source))) localStorage.setItem(PREFIX + key, source);
        }
        for (const [id, mod] of Object.entries(tx.candidateRegistry)) {
          const key = mod.sourceKey || moduleBundleKey(mod);
          const updatedDescriptor = tx.manifest.modules.find(candidate => candidate.id === id);
          const source = updatedDescriptor ? tx.files[updatedDescriptor.entry] : (await nativeRead('module-bundles', key) || localStorage.getItem(PREFIX + key));
          if (typeof source !== 'string') throw new Error('Active module source missing for ' + id);
          if (mod.sha256 && (await sha256(source)).toLowerCase() !== String(mod.sha256).toLowerCase()) throw new Error('Stored module hash mismatch for ' + id);
          const dispose = await activateCode(mod, source, api);
          loadedModules.set(id, { version: mod.version, dispose, entry: mod.entry });
        }
        await writeManaged('active-modules', tx.candidateRegistry);
        await writeManaged('config', tx.candidateConfig);
        tx.state = 'committed'; tx.decision = 'commit'; tx.committedAt = new Date().toISOString(); tx.files = {};
        await writeManaged('transaction-' + txId, tx);
        const index = await readManaged('transaction-index', []); if (!index.includes(txId)) { index.push(txId); await writeManaged('transaction-index', index.slice(-100)); }
        await Diagnostics.record('update', 'update-committed', { txId, updateId: tx.updateId });
        Events.emit('update:committed', { txId, updateId: tx.updateId });
        return { transactionId: txId, state: tx.state };
      } catch (error) {
        for (const [id, current] of loadedModules) { try { if (typeof current.dispose === 'function') await current.dispose(); } catch (_) {} }
        loadedModules.clear();
        await writeManaged('active-modules', tx.previousRegistry);
        await writeManaged('config', tx.previousConfig);
        for (const [id, mod] of Object.entries(tx.previousRegistry || {})) {
          try {
            const key = mod.sourceKey || moduleBundleKey(mod);
            const source = await nativeRead('module-bundles', key) || localStorage.getItem(PREFIX + key);
            if (typeof source === 'string') {
              const dispose = await activateCode(mod, source, api);
              loadedModules.set(id, { version: mod.version, dispose, entry: mod.entry });
            }
          } catch (restoreError) { await Diagnostics.record('error', 'module-recovery-failed', { id, message: restoreError.message }); }
        }
        tx.state = 'activation-failed'; tx.error = String(error.message || error); tx.decision = 'commit-failed';
        await writeManaged('transaction-' + txId, tx);
        await Diagnostics.record('recovery', 'update-activation-failed', { txId, message: tx.error });
        throw error;
      }
    },
    async rollback(txId) {
      if (!safeId(txId)) throw new Error('Invalid transaction ID.');
      const tx = await readManaged('transaction-' + txId, null);
      if (!tx) throw new Error('Transaction not found.');
      if (tx.state === 'awaiting-manual-decision') {
        tx.state = 'rolled-back'; tx.decision = 'rollback'; tx.rolledBackAt = new Date().toISOString(); tx.files = {};
        await writeManaged('transaction-' + txId, tx);
        await Diagnostics.record('update', 'staged-update-discarded', { txId, updateId: tx.updateId });
        return { transactionId: txId, state: tx.state };
      }
      if (tx.state !== 'committed') throw new Error('Only staged or committed transactions can be rolled back.');
      for (const [id, current] of loadedModules) { try { if (typeof current.dispose === 'function') await current.dispose(); } catch (_) {} }
      loadedModules.clear();
      await writeManaged('active-modules', tx.previousRegistry);
      await writeManaged('config', tx.previousConfig);
      const api = Object.freeze({ version: VERSION, runtimeApi: RUNTIME_API, storage: Storage, events: Events, diagnostics: Diagnostics });
      for (const [id, mod] of Object.entries(tx.previousRegistry || {})) {
        const key = mod.sourceKey || moduleBundleKey(mod);
        const source = await nativeRead('module-bundles', key) || localStorage.getItem(PREFIX + key);
        if (typeof source !== 'string') throw new Error('Cannot restore previous module source: ' + id);
        const dispose = await activateCode(mod, source, api);
        loadedModules.set(id, { version: mod.version, dispose, entry: mod.entry });
      }
      tx.state = 'rolled-back'; tx.decision = 'rollback'; tx.rolledBackAt = new Date().toISOString();
      await writeManaged('transaction-' + txId, tx);
      await Diagnostics.record('recovery', 'committed-update-rolled-back', { txId, updateId: tx.updateId });
      Events.emit('update:rolled-back', { txId, updateId: tx.updateId });
      return { transactionId: txId, state: tx.state, note: 'Module-owned data is preserved; apply a compatible migration if its schema changed.' };
    }
  };

  const Native = {
    get available() { return !!native; },
    async info() {
      if (!native || typeof native.getRuntimeInfo !== 'function') return { available: false, platform: global.Capacitor?.getPlatform?.() || 'web' };
      return native.getRuntimeInfo();
    }
  };

  const Port = {
    async status() {
      return { runtime: VERSION, runtimeApi: RUNTIME_API, appId: APP_ID, native: Native.available, updateDecision: 'manual', debugPolicy: 'balanced', loadedModules: [...loadedModules.keys()] };
    },
    stageUpdate(pkg) { return Updates.stage(pkg); },
    commit(txId) { return Updates.commit(txId); },
    rollback(txId) { return Updates.rollback(txId); }
  };

  const Loadout = Object.freeze({ version: VERSION, runtimeApi: RUNTIME_API, appId: APP_ID, native: Native, storage: Storage, diagnostics: Diagnostics, events: Events, updates: Updates, port: Port });
  global.Loadout = Loadout;
  global.LoadoutReady = (async () => {
    const registry = await readManaged('active-modules', {});
    const api = Object.freeze({ version: VERSION, runtimeApi: RUNTIME_API, storage: Storage, events: Events, diagnostics: Diagnostics });
    for (const [id, mod] of Object.entries(registry || {})) {
      try {
        const key = mod.sourceKey || moduleBundleKey(mod);
        const source = await nativeRead('module-bundles', key) || localStorage.getItem(PREFIX + key);
        if (typeof source !== 'string' || (mod.sha256 && (await sha256(source)).toLowerCase() !== String(mod.sha256).toLowerCase())) throw new Error('Missing or invalid stored module source.');
        const dispose = await activateCode(mod, source, api);
        loadedModules.set(id, { version: mod.version, dispose, entry: mod.entry });
      } catch (error) { await Diagnostics.record('error', 'module-startup-failed', { id, message: error.message }); }
    }
    return { loadedModules: [...loadedModules.keys()] };
  })();
  if (global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function' && global.Capacitor.isNativePlatform()) {
    Native.info().catch(error => Diagnostics.record('warn', 'native-runtime-info-failed', { message: error.message }));
  }
})(window);
