import fs from 'node:fs/promises';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {createPolicy, validateTargets, publicText, PilotError} from './policy.mjs';

const started = performance.now();
const out = new URL('./artifacts/', import.meta.url);
const report = {
  schema: 1, startedAt: new Date().toISOString(),
  scope: 'One public homepage document GET; scripts disabled; every other network request blocked. Diagnostic screenshots are intentionally unstyled and incomplete.',
  cloudExecutionPassed: false, fullAuditPerformed: false, candidateTested: false,
  liveSiteQualityPassed: null, productionChanged: false, realSubmissions: 0,
  targets: [], viewports: [], fatalCodes: [],
  network: {permittedDocumentGets: 0, upstreamDocumentGets: 0, completedDocumentResponses: 0, deniedCounts: {}, websocketConnectionsBlocked: 0,
    documentTransport: 'One upstream GET through route.fetch(maxRedirects:0,maxRetries:0), fulfilled into Chromium. Redirect responses are aborted before browser delivery.'},
  accessibility: {status: 'not_run', reason: 'Strict script-disabled, all-subresource-blocked pilot. No axe or live-site accessibility quality pass is claimed.'},
  cleanup: {browserLaunched: false, contextsOpened: 0, contextsClosed: 0, closeRequested: false,
    closeAwaited: false, disconnected: false, connectedAfterClose: null},
};
const fatal = code => { if (!report.fatalCodes.includes(code)) report.fatalCodes.push(code); };
const increment = reason => { report.network.deniedCounts[reason] = (report.network.deniedCounts[reason] || 0) + 1; };
const installed = async name => JSON.parse(await fs.readFile(new URL(`./node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;
let browser, context, policy;

async function hostProof() {
  const release = Object.fromEntries((await fs.readFile('/etc/os-release', 'utf8')).split('\n')
    .filter(line => /^(ID|VERSION_ID)=/.test(line)).map(line => {
      const [key, value] = line.split('='); return [key, value.replaceAll('"', '')];
    }));
  return {
    githubActions: process.env.GITHUB_ACTIONS === 'true',
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT === 'github-hosted' ? 'github-hosted' : 'other-or-unknown',
    runnerOS: process.env.RUNNER_OS === 'Linux' ? 'Linux' : 'other-or-unknown',
    platform: os.platform(), type: os.type(), kernel: os.release(), architecture: os.arch(),
    distribution: release.ID, distributionVersion: release.VERSION_ID,
    hostedWorkflowRequestedLabel: 'ubuntu-24.04',
  };
}

async function oneActiveChromeRssSample() {
  // One finite event sample of this job's descendants. No timers, monitor or signaling.
  try {
    const {stdout} = await promisify(execFile)('ps', ['-eo', 'pid=,ppid=,rss=,comm='], {timeout: 2000, maxBuffer: 1048576});
    const rows = stdout.split('\n').flatMap(line => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      return match ? [{pid: Number(match[1]), ppid: Number(match[2]), rss: Number(match[3]), executable: match[4]}] : [];
    });
    const descendants = new Set([process.pid]);
    for (let changed = true; changed;) {
      changed = false;
      for (const row of rows) if (descendants.has(row.ppid) && !descendants.has(row.pid)) {descendants.add(row.pid); changed = true;}
    }
    const chrome = rows.filter(row => descendants.has(row.pid) && /chrome|chromium/i.test(row.executable));
    const rssKiB = chrome.reduce((sum, row) => sum + row.rss, 0);
    return {available: chrome.length > 0, event: 'first homepage rendered, browser active',
      secondsAfterStart: Number(((performance.now() - started) / 1000).toFixed(3)),
      chromeProcesses: chrome.length, rssKiB, rssMiB: Number((rssKiB / 1024).toFixed(2)),
      limit: 'One descendant executable-name sample. RSS sums can double count shared memory; this is not total physical footprint or Mac savings.'};
  } catch {
    return {available: false, event: 'first homepage rendered, browser active', reason: 'RSS_SAMPLE_UNAVAILABLE'};
  }
}

await fs.mkdir(out, {recursive: true});
try {
  const target = validateTargets(JSON.parse(await fs.readFile(new URL('./targets.json', import.meta.url), 'utf8')));
  report.targets = [target.url];
  report.host = await hostProof();
  if (!report.host.githubActions || report.host.runnerEnvironment !== 'github-hosted' || report.host.runnerOS !== 'Linux'
      || report.host.platform !== 'linux' || report.host.distribution !== 'ubuntu' || report.host.distributionVersion !== '24.04') {
    throw new PilotError('STANDARD_GITHUB_HOSTED_UBUNTU_24_04_REQUIRED');
  }
  report.versions = {node: process.versions.node, playwright: await installed('playwright'),
    playwrightCore: await installed('playwright-core'), axePlaywright: await installed('@axe-core/playwright'), axeCore: await installed('axe-core')};
  if (report.versions.node !== '22.19.0' || report.versions.playwright !== '1.63.0'
      || report.versions.playwrightCore !== '1.63.0' || report.versions.axePlaywright !== '4.13.0'
      || report.versions.axeCore !== '4.13.0') throw new PilotError('PINNED_VERSION_MISMATCH');
  policy = createPolicy(target);
  browser = await chromium.launch({headless: true, timeout: 30000});
  report.cleanup.browserLaunched = true;
  report.versions.chromium = browser.version();
  browser.on('disconnected', () => {report.cleanup.disconnected = true;});
  context = await browser.newContext({javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false,
    viewport: {width: 390, height: 900}, reducedMotion: 'reduce'});
  report.cleanup.contextsOpened++;
  await context.routeWebSocket('**/*', socket => {
    report.network.websocketConnectionsBlocked++;
    socket.close({code: 1008, reason: 'Public read-only pilot'});
  });
  await context.route('**/*', async route => {
    const request = route.request();
    let mainFrame = false;
    try { mainFrame = request.frame().parentFrame() === null; } catch {}
    const decision = policy.decide({url: request.url(), method: request.method(),
      navigation: request.isNavigationRequest(), mainFrame, redirected: Boolean(request.redirectedFrom())});
    if (decision.allow) {
      try {
        report.network.upstreamDocumentGets++;
        const upstream = await route.fetch({maxRedirects: 0, maxRetries: 0, timeout: 30000});
        report.network.upstreamDocumentStatus = upstream.status();
        if (upstream.status() === 429) {fatal('HTTP_429'); return route.abort('blockedbyclient');}
        if (upstream.status() >= 300 && upstream.status() < 400) {fatal('UNEXPECTED_REDIRECT'); return route.abort('blockedbyclient');}
        return route.fulfill({response: upstream});
      } catch {fatal('DOCUMENT_FETCH_FAILED'); return route.abort('blockedbyclient');}
    }
    increment(decision.reason);
    if (decision.fatal) fatal(decision.reason);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  report.consoleCounts = {};
  report.pageErrorCount = 0;
  page.on('console', message => {const type = message.type(); report.consoleCounts[type] = (report.consoleCounts[type] || 0) + 1;});
  page.on('pageerror', () => {report.pageErrorCount++;});
  context.on('page', extra => {if (extra !== page) {fatal('UNEXPECTED_PAGE'); void extra.close().catch(() => {});}});
  page.on('response', response => {
    if (response.status() === 429) fatal('HTTP_429');
    if (response.status() >= 300 && response.status() < 400) fatal('UNEXPECTED_REDIRECT');
  });
  // The sole navigation; a redirect is never followed by the upstream fetch.
  const response = await page.goto(target.url, {waitUntil: 'domcontentloaded', timeout: 30000});
  if (!response || page.url() !== target.url || response.request().redirectedFrom()) throw new PilotError('UNEXPECTED_DOCUMENT_RESPONSE');
  report.network.completedDocumentResponses++;
  if (report.fatalCodes.length) throw new PilotError('NETWORK_POLICY_FAILED');
  report.documentStatus = response.status();
  const htmlSha256 = createHash('sha256').update(await response.body()).digest('hex');
  report.publicHtmlDrift = {currentSha256: htmlSha256, previousSha256: target.assertions.previousHtmlSha256 || null,
    matchesPrevious: target.assertions.previousHtmlSha256 ? htmlSha256 === target.assertions.previousHtmlSha256 : null,
    interpretation: 'Hash of the sole document response; drift is reported without another fetch. No HTML retained.'};
  const title = await page.title();
  const headings = await page.locator('h1').allTextContents();
  const canonicals = await page.locator('link[rel="canonical"]').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
  const readableBody = await page.locator('body').innerText();
  const normalize = value => value.replace(/\s+/g, ' ').trim();
  report.publicIdentity = {
    title: publicText(title), h1: headings.slice(0, 10).map(value => publicText(value)),
    readableCharacterCount: readableBody.length,
    assertions: {
      status200: response.status() === 200,
      titleEquals: normalize(title) === normalize(target.assertions.titleEquals),
      exactlyOneH1: headings.length === 1,
      h1Equals: headings.length === 1 && normalize(headings[0]) === normalize(target.assertions.h1Equals),
      canonicalEquals: canonicals.length === 1 && canonicals[0] === target.assertions.canonicalEquals,
      bodyIncludes: target.assertions.bodyIncludes.map(text => ({expectedPublicText: text, passed: normalize(readableBody).includes(normalize(text))})),
    },
  };
  report.memory = await oneActiveChromeRssSample();
  for (const width of [390]) {
    const layout = await page.evaluate(() => ({innerWidth, scrollWidth: document.documentElement.scrollWidth,
      readableBodyPresent: Boolean(document.body?.innerText.trim()), scriptsDisabled: true}));
    const screenshot = `homepage-${width}.png`;
    await page.screenshot({path: new URL(screenshot, out).pathname, fullPage: false, animations: 'disabled', timeout: 15000});
    report.viewports.push({width, height: 900, layout, screenshot,
      interpretation: 'Public HTML only; assets, styles and scripts intentionally blocked. Not a visual baseline or responsive-site quality verdict.'});
  }
  if (page.url() !== target.url) fatal('UNEXPECTED_FINAL_URL');
} catch (error) {
  // Never publish raw exception messages, stack traces, console text, URLs or HTML.
  fatal(error instanceof PilotError ? error.code : 'EXECUTION_FAILED');
} finally {
  report.network.permittedDocumentGets = policy?.permittedDocumentGets || 0;
  if (context) {
    try {await context.close(); report.cleanup.contextsClosed++;} catch {fatal('CONTEXT_CLOSE_FAILED');}
  }
  if (browser) {
    report.cleanup.closeRequested = true;
    try {await browser.close(); report.cleanup.closeAwaited = true;} catch {fatal('BROWSER_CLOSE_FAILED');}
    report.cleanup.connectedAfterClose = browser.isConnected();
  }
  report.durationSeconds = Number(((performance.now() - started) / 1000).toFixed(3));
  report.finishedAt = new Date().toISOString();
  report.cloudExecutionPassed = report.fatalCodes.length === 0 && report.network.permittedDocumentGets === 1
    && report.network.upstreamDocumentGets === 1 && report.network.completedDocumentResponses === 1 && report.viewports.length === 1 && report.memory?.available === true
    && report.cleanup.contextsClosed === report.cleanup.contextsOpened && report.cleanup.closeAwaited
    && report.cleanup.disconnected && report.cleanup.connectedAfterClose === false;
  report.websiteIdentityAssertionsPassed = report.publicIdentity ? Object.values(report.publicIdentity.assertions)
    .every(value => Array.isArray(value) ? value.every(item => item.passed) : value === true) : null;
  await fs.writeFile(new URL('diagnostics.json', out), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({cloudExecutionPassed: report.cloudExecutionPassed, websiteIdentityAssertionsPassed: report.websiteIdentityAssertionsPassed,
    durationSeconds: report.durationSeconds, permittedDocumentGets: report.network.permittedDocumentGets, fatalCodes: report.fatalCodes}));
  process.exitCode = report.cloudExecutionPassed && report.websiteIdentityAssertionsPassed === true ? 0 : 1;
}
