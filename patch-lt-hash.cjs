/**
 * Patch for @whiskeysockets/baileys lt-hash.js
 * Fixes: "Cannot read properties of undefined (reading 'slice')"
 * Occurs when auth state data is plain JS arrays (from JSON) without .buffer property.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'node_modules/@whiskeysockets/baileys/lib/Utils/lt-hash.js');

if (!fs.existsSync(filePath)) {
    console.log('lt-hash.js not found, skipping patch');
    process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');

// Strip any previously applied (broken) patch
content = content.replace(
    /const toAB = \(b\) => b instanceof ArrayBuffer \? b : b\.buffer\.slice\(b\.byteOffset, b\.byteOffset \+ b\.byteLength\);\s*e = toAB\(e\); t = toAB\(t\);\s*/g,
    ''
);

const original = `    performPointwiseWithOverflow(e, t, r) {
        const n = new DataView(e), i = new DataView(t), a = new ArrayBuffer(n.byteLength), s = new DataView(a);`;

const patched = `    performPointwiseWithOverflow(e, t, r) {
        const toAB = (b) => {
            if (b instanceof ArrayBuffer) return b;
            if (b && b.buffer instanceof ArrayBuffer) return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
            const arr = Array.isArray(b) ? b : Object.values(b);
            const buf = Buffer.from(arr);
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        };
        e = toAB(e); t = toAB(t);
        const n = new DataView(e), i = new DataView(t), a = new ArrayBuffer(n.byteLength), s = new DataView(a);`;

if (content.includes(original)) {
    content = content.replace(original, patched);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('lt-hash.js patched successfully (robust version)');
} else if (content.includes('toAB')) {
    console.log('lt-hash.js already patched');
} else {
    console.log('WARNING: lt-hash.js pattern not found, patch skipped');
    const idx = content.indexOf('performPointwiseWithOverflow');
    if (idx !== -1) console.log(content.substring(idx - 10, idx + 300));
}
