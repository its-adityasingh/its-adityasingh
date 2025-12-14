// deobf.js
// Usage: node deobf.js <input-file> <output-file>
// Creates a best-effort deobfuscated output by inlining t9Ojp1[...] lookups
// and simple helper-call results. Run locally; don't upload sensitive code.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

if (process.argv.length < 4) {
  console.error("Usage: node deobf.js <input-file> <output-file>");
  process.exit(2);
}

const inFile = process.argv[2];
const outFile = process.argv[3];
const src = fs.readFileSync(inFile,'utf8');

// 1) Extract the const t9Ojp1 = [...] ; block
const arrMatch = src.match(/const\s+t9Ojp1\s*=\s*(\[[\s\S]*?\]);/);
if (!arrMatch) {
  console.error("Could not find 'const t9Ojp1 = [...]' in file.");
  process.exit(3);
}

const arrCode = arrMatch[1];

// 2) Safely evaluate the array in a VM to get JS values
let lookup = null;
try {
  const script = new vm.Script('lookup = ' + arrCode);
  const sandbox = { lookup: null };
  vm.createContext(sandbox);
  script.runInContext(sandbox, {timeout: 2000});
  lookup = sandbox.lookup;
  if (!Array.isArray(lookup)) throw new Error("not array");
} catch (e) {
  console.error("Failed to evaluate t9Ojp1 array in sandbox:", e.message);
  process.exit(4);
}

// 3) Try to extract a helper function definition like function HmCM3g0(...) { ... }
//    We'll try a few common name patterns found in the file.
let helperName = null;
let helperFn = null;
const helperRegex = /function\s+(HmCM3g0|HmCM3g[0-9a-zA-Z_]*)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/;
const helperMatch = src.match(helperRegex);
if (helperMatch) {
  helperName = helperMatch[1];
  const fnSrc = helperMatch[0]; // full function source
  try {
    // evaluate the function in a sandbox so we can call it
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(fnSrc + `\nthis._helper = ${helperName};`, sandbox, {timeout:2000});
    helperFn = sandbox._helper;
    if (typeof helperFn !== 'function') helperFn = null;
    else console.log("Helper function found and loaded:", helperName);
  } catch (e) {
    console.warn("Failed to evaluate helper function in sandbox:", e.message);
    helperFn = null;
  }
} else {
  // maybe helper is defined as var HmCM3g0 = function(...) { ... }
  const altRegex = /(?:var|let|const)\s+(HmCM3g0[0-9a-zA-Z_]*)\s*=\s*function\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/;
  const altMatch = src.match(altRegex);
  if (altMatch) {
    helperName = altMatch[1];
    const fnSrc = altMatch[0];
    try {
      const sandbox = {};
      vm.createContext(sandbox);
      vm.runInContext(fnSrc + `\nthis._helper = ${helperName};`, sandbox, {timeout:2000});
      helperFn = sandbox._helper;
      if (typeof helperFn !== 'function') helperFn = null;
      else console.log("Helper function found and loaded:", helperName);
    } catch (e) {
      console.warn("Failed to evaluate helper function in sandbox:", e.message);
      helperFn = null;
    }
  }
}

console.log("Lookup array length:", lookup.length);

// 4) Build replacer functions
function valueToLiteral(v){
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string'){
    // escape backslashes and quotes
    return JSON.stringify(v);
  }
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  // For objects or arrays, JSON.stringify safely (may be large)
  try { return JSON.stringify(v); } catch(e){ return '"[object]"'; }
}

// Replace t9Ojp1[0x1a] or t9Ojp1[26] forms
let deob = src.replace(/t9Ojp1\s*\[\s*(0x[a-fA-F0-9]+|\d+)\s*\]/g, (m, idx){
  try {
    const n = (idx.startsWith('0x') ? parseInt(idx,16) : parseInt(idx,10));
    if (n >= 0 && n < lookup.length) return valueToLiteral(lookup[n]);
    return m;
  } catch(e) { return m; }
});

// 5) Replace HmCM3g0( <number or expression> ) when helperFn is available
if (helperFn){
  // simple numeric argument cases only
  deob = deob.replace(new RegExp(helperName + "\\s*\\(\\s*(0x[a-fA-F0-9]+|\\d+)\\s*\\)", 'g'), (m, arg) => {
    try {
      const n = arg.startsWith('0x') ? parseInt(arg,16) : parseInt(arg,10);
      // call helperFn safely in vm context to compute actual string
      // helperFn may expect t9Ojp1 or other globals — we do best-effort with lookup present
      const ctx = { lookup: lookup, result: null };
      vm.createContext(ctx);
      // create a small wrapper calling helper with numeric arg (works for many obfuscators)
      const runSrc = `${fnWrap(helperName)}; result = ${helperName}(${n});`;
      // However fnWrap is not defined here; simpler approach: re-declare helperFn in context:
      ctx[helperName] = helperFn;
      ctx.result = helperFn(n);
      return valueToLiteral(ctx.result);
    } catch(e){
      return m;
    }
  });
} else {
  console.log("No helper function loaded — skipping HmCM3g0(...) replacements.");
}

// 6) Output
fs.writeFileSync(outFile, deob, 'utf8');
console.log("Deobfuscated output written to", outFile);

// Helper: dummy placeholder (not used but kept for clarity)
function fnWrap(name){ return "// wrapper"; }
