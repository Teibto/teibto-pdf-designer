/** Authenticated batch storage. Secret values never leave N/crypto.
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @author Wichit Wongta
 * @since 2026-09-09
 */
define(['N/crypto', 'N/encode', 'N/runtime'], (crypto, encode, runtime) => {
    'use strict';
    const DOMAINS = ['job', 'snapshot', 'part', 'result', 'artifact', 'plan', 'manifest', 'cleanup', 'recovery'];
    const HEX = /^[0-9a-f]{64}$/;
    const SECRET = 'custsecret_pld_batch_v1';
    const fail = () => { throw new Error('ไม่สามารถยืนยันความถูกต้องของงานพิมพ์ (Batch integrity verification failed) — ติดต่อผู้ดูแลเพื่อตรวจสอบการตั้งค่าและสิทธิ์'); };

    function validText(value) {
        if (typeof value !== 'string') fail();
        // Reject unpaired surrogates, which UTF-8 conversion would replace silently.
        for (let i = 0; i < value.length; i++) {
            const c = value.charCodeAt(i);
            if (c >= 0xd800 && c <= 0xdbff) {
                const next = value.charCodeAt(++i);
                if (!(next >= 0xdc00 && next <= 0xdfff)) fail();
            } else if (c >= 0xdc00 && c <= 0xdfff) fail();
        }
        return value;
    }

    function canonical(value, ancestors) {
        ancestors = ancestors || [];
        if (value === null || typeof value === 'boolean') return JSON.stringify(value);
        if (typeof value === 'string') return JSON.stringify(validText(value));
        if (typeof value === 'number') {
            if (!Number.isFinite(value) || Object.is(value, -0)) fail();
            return JSON.stringify(value);
        }
        if (typeof value !== 'object' || ancestors.indexOf(value) !== -1 || ancestors.length >= 128) fail();
        const proto = Object.getPrototypeOf(value);
        if (!Array.isArray(value) && proto !== null &&
            (Object.getPrototypeOf(proto) !== null || !Object.prototype.hasOwnProperty.call(proto, 'constructor') ||
                proto.constructor.name !== 'Object')) fail();
        const keys = Reflect.ownKeys(value);
        if (keys.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].indexOf(key) !== -1)) fail();
        const next = ancestors.concat([value]);
        const read = key => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail();
            return canonical(descriptor.value, next);
        };
        if (Array.isArray(value)) {
            if (keys.length !== value.length + 1) fail();
            const entries = [];
            for (let i = 0; i < value.length; i++) entries.push(read(String(i)));
            return '[' + entries.join(',') + ']';
        }
        return '{' + keys.sort().map(key => JSON.stringify(validText(key)) + ':' + read(key)).join(',') + '}';
    }

    function context(domain) {
        if (DOMAINS.indexOf(domain) === -1) fail();
        const accountId = validText(runtime.accountId);
        const environment = validText(runtime.envType);
        if (!accountId || !environment) fail();
        return { version: 1, keyId: 'v1', accountId, environment, domain };
    }

    function mac(text) {
        try {
            const key = crypto.createSecretKey({ secret: SECRET, encoding: encode.Encoding.UTF_8 });
            if (!key) fail();
            const hmac = crypto.createHmac({ algorithm: crypto.HashAlg.SHA256, key });
            hmac.update({ input: text, inputEncoding: encode.Encoding.UTF_8 });
            const result = hmac.digest({ outputEncoding: encode.Encoding.HEX });
            if (typeof result !== 'string' || !HEX.test(result)) fail();
            return result;
        } catch (_) { fail(); }
    }

    function seal(domain, data) {
        const envelope = Object.assign(context(domain), { data });
        envelope.mac = mac(canonical(envelope));
        return canonical(envelope);
    }

    function open(domain, text) {
        const expected = context(domain);
        let envelope;
        try { envelope = JSON.parse(validText(text)); } catch (_) { fail(); }
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
            Object.keys(envelope).sort().join(',') !== 'accountId,data,domain,environment,keyId,mac,version') fail();
        // Only our canonical wire format is accepted, including unique JSON keys.
        if (canonical(envelope) !== text) fail();
        for (const key of Object.keys(expected)) if (envelope[key] !== expected[key]) fail();
        if (typeof envelope.mac !== 'string' || !HEX.test(envelope.mac)) fail();
        const received = envelope.mac;
        delete envelope.mac;
        const computed = mac(canonical(envelope));
        // Fixed-length comparison visits every character; JS does not promise constant timing.
        let difference = 0;
        for (let i = 0; i < 64; i++) difference |= received.charCodeAt(i) ^ computed.charCodeAt(i);
        if (difference !== 0) fail();
        return envelope.data;
    }

    function hash(text, inputEncoding) {
        validText(text);
        const digest = crypto.createHash({ algorithm: crypto.HashAlg.SHA256 });
        digest.update({ input: text, inputEncoding });
        const result = digest.digest({ outputEncoding: encode.Encoding.HEX });
        if (typeof result !== 'string' || !HEX.test(result)) fail();
        return result;
    }

    function digest(text) { return hash(text, encode.Encoding.UTF_8); }
    function digestPdf(base64) {
        // N/file PDF contents are base64. Reject ambiguous/non-canonical encodings.
        validText(base64);
        if (!base64 || base64.length % 4 !== 0) fail();
        const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
        // Avoid a repeated-group regex whose backtracking stack grows with PDF size.
        if (/[^A-Za-z0-9+/]/.test(base64.slice(0, base64.length - padding))) fail();
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        if (base64.endsWith('==') && (alphabet.indexOf(base64[base64.length - 3]) & 15)) fail();
        if (!base64.endsWith('==') && base64.endsWith('=') && (alphabet.indexOf(base64[base64.length - 2]) & 3)) fail();
        return hash(base64, encode.Encoding.BASE_64);
    }

    return { seal, open, digest, digestPdf };
});
