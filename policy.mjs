import {isIP} from 'node:net';

export class PilotError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const plain = value => typeof value === 'string' && value.length > 0 && value.length <= 256
  && !/[\r\n<>]/.test(value) && !/https?:\/\/\S*[?#]/i.test(value);

export function validateTargets(input) {
  if (!Array.isArray(input) || input.length !== 1) throw new PilotError('EXACTLY_ONE_REVIEWED_TARGET_REQUIRED');
  const target = input[0];
  if (!target || typeof target !== 'object' || typeof target.url !== 'string') throw new PilotError('INVALID_TARGET');
  let url;
  try { url = new URL(target.url); } catch { throw new PilotError('INVALID_TARGET'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || url.pathname !== '/' || isIP(hostname) || !hostname.includes('.')
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(hostname)
      || target.url !== url.href) throw new PilotError('PUBLIC_CANONICAL_HTTPS_HOMEPAGE_REQUIRED');
  const assertions = target.assertions;
  if (!assertions || !plain(assertions.titleEquals) || !plain(assertions.h1Equals)
      || assertions.canonicalEquals !== url.href
      || !Array.isArray(assertions.bodyIncludes) || !assertions.bodyIncludes.length
      || assertions.bodyIncludes.length > 5 || assertions.bodyIncludes.some(value => !plain(value))
      || (assertions.previousHtmlSha256 !== undefined && !/^[a-f0-9]{64}$/.test(assertions.previousHtmlSha256))) {
    throw new PilotError('REVIEWED_PUBLIC_IDENTITY_ASSERTIONS_REQUIRED');
  }
  return {url: url.href, origin: url.origin, assertions: {
    titleEquals: assertions.titleEquals, h1Equals: assertions.h1Equals,
    canonicalEquals: assertions.canonicalEquals, bodyIncludes: [...assertions.bodyIncludes],
    previousHtmlSha256: assertions.previousHtmlSha256,
  }};
}

export function createPolicy(target) {
  let permittedDocumentGets = 0;
  return {
    get permittedDocumentGets() { return permittedDocumentGets; },
    decide({url, method, navigation = false, mainFrame = false, redirected = false}) {
      if (!['GET', 'HEAD'].includes(method)) return {allow: false, reason: 'MUTATION_ATTEMPT', fatal: true};
      if (redirected) return {allow: false, reason: 'UNEXPECTED_REDIRECT', fatal: true};
      if (navigation && mainFrame) {
        if (permittedDocumentGets) return {allow: false, reason: 'SECOND_NAVIGATION', fatal: true};
        if (method !== 'GET' || url !== target.url) return {allow: false, reason: 'UNEXPECTED_NAVIGATION', fatal: true};
        permittedDocumentGets++;
        return {allow: true, reason: 'APPROVED_HOMEPAGE_GET', fatal: false};
      }
      // No stylesheet/image/font/script/API/frame/other-origin request is permitted.
      return {allow: false, reason: 'ALL_OTHER_NETWORK_BLOCKED', fatal: false};
    },
  };
}

export function publicText(value, maximum = 256) {
  return String(value).replace(/https?:\/\/[^\s<>]+/gi, '[URL omitted]')
    .replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}
