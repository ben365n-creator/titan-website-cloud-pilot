import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPolicy, validateTargets, publicText} from './policy.mjs';

const sample = () => ({url: 'https://example.com/', assertions: {
  titleEquals: 'Example', h1Equals: 'Example', canonicalEquals: 'https://example.com/', bodyIncludes: ['Public company'],
}});
const nav = {url: 'https://example.com/', method: 'GET', navigation: true, mainFrame: true};

test('empty targets fail closed until explicit review', () => {
  assert.throws(() => validateTargets([]), /EXACTLY_ONE_REVIEWED_TARGET_REQUIRED/);
  assert.throws(() => validateTargets([sample(), sample()]), /EXACTLY_ONE_REVIEWED_TARGET_REQUIRED/);
});
test('only one public canonical homepage with public identity assertions is accepted', () => {
  assert.equal(validateTargets([sample()]).url, 'https://example.com/');
  for (const url of ['http://example.com/', 'https://example.com/api/', 'https://example.com/preview.php',
    'https://example.com/?token=secret', 'https://example.com/#fragment', 'https://user:pass@example.com/',
    'https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 'https://app.internal/',
    'https://example.com:444/', 'https://example.com']) {
    assert.throws(() => validateTargets([{...sample(), url}]), /PUBLIC_CANONICAL_HTTPS_HOMEPAGE_REQUIRED/);
  }
  assert.throws(() => validateTargets([{...sample(), assertions: {}}]), /REVIEWED_PUBLIC_IDENTITY_ASSERTIONS_REQUIRED/);
});
test('exactly one main document GET can be permitted', () => {
  const policy = createPolicy(validateTargets([sample()]));
  assert.equal(policy.decide(nav).allow, true);
  assert.equal(policy.permittedDocumentGets, 1);
  assert.deepEqual(policy.decide(nav), {allow: false, reason: 'SECOND_NAVIGATION', fatal: true});
});
test('styles, static assets, fonts, scripts, external origins and frames are all blocked', () => {
  const policy = createPolicy(validateTargets([sample()]));
  for (const url of ['https://example.com/main.css', 'https://example.com/logo.png',
    'https://example.com/main.js', 'https://example.com/font.woff2', 'https://example.com/api/',
    'https://example.com/auth/', 'https://example.com/customer/', 'https://example.com/submit/',
    'https://example.com/preview.php', 'https://fonts.googleapis.com/css', 'https://other.example/']) {
    assert.equal(policy.decide({url, method: 'GET'}).allow, false);
    assert.equal(policy.decide({url, method: 'HEAD'}).allow, false);
    assert.equal(policy.decide({url, method: 'GET', navigation: true, mainFrame: false}).allow, false);
  }
  assert.equal(policy.permittedDocumentGets, 0);
});
test('all mutation methods fail the pilot without granting a document request', () => {
  const policy = createPolicy(validateTargets([sample()]));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT']) {
    assert.deepEqual(policy.decide({...nav, method}), {allow: false, reason: 'MUTATION_ATTEMPT', fatal: true});
  }
  assert.equal(policy.permittedDocumentGets, 0);
});
test('redirects and any changed navigation fail closed', () => {
  const policy = createPolicy(validateTargets([sample()]));
  assert.equal(policy.decide({...nav, redirected: true}).reason, 'UNEXPECTED_REDIRECT');
  for (const url of ['https://example.com/other/', 'https://example.com/?customer=private', 'https://other.example/']) {
    assert.equal(policy.decide({...nav, url}).reason, 'UNEXPECTED_NAVIGATION');
  }
  assert.equal(policy.decide({...nav, method: 'HEAD'}).allow, false);
  assert.equal(policy.permittedDocumentGets, 0);
});
test('diagnostic text does not retain raw URLs, queries, HTML delimiters or control lines', () => {
  const result = publicText('<h1>Public\nhttps://example.com/?secret=private</h1>');
  assert.equal(result.includes('secret'), false);
  assert.equal(/[<>\n]/.test(result), false);
  assert.equal(publicText('x'.repeat(500)).length, 256);
});
