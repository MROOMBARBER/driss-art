import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { chromium } from 'playwright';

const projectId = 'demo-xauusd';
const origin = process.env.PORTAL_E2E_ORIGIN || 'http://127.0.0.1:5173';
const artifacts = '/workspace/scratch';

function requireEmulators() {
  // The Admin SDK bypasses rules and must never connect to a live project.
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099', 'Auth emulator must be on loopback.');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080', 'Firestore emulator must be on loopback.');
  for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (process.env[name]) assert.equal(process.env[name], projectId, `Only ${projectId} is allowed.`);
  }
  if (process.env.FIREBASE_CONFIG) {
    const config = JSON.parse(process.env.FIREBASE_CONFIG);
    assert.equal(config.projectId, projectId, 'Refusing a non-demo Firebase project.');
  }
  assert.equal(new URL(origin).origin, 'http://127.0.0.1:5173', 'The browser must use the local emulator-mode server.');
}

async function eventually(read, matches, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let value;
  let lastError;
  while (Date.now() < deadline) {
    try {
      value = await read();
      if (matches(value)) return value;
      lastError = undefined;
    } catch (error) { lastError = error; }
    await delay(100);
  }
  assert.fail(`${description}${lastError ? `: ${lastError.message}` : `; observed ${JSON.stringify(value)}`}`);
}

async function visible(locator, description) {
  await eventually(() => locator.isVisible(), Boolean, description);
}

async function login(page, email, password) {
  await page.goto(`${origin}/connexion`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Adresse e-mail', { exact: true }).fill(email);
  await page.getByLabel(/^Mot de passe/).fill(password);
  await page.getByRole('button', { name: 'Accéder à mon espace', exact: true }).click();
  await page.waitForURL(`${origin}/dashboard`);
  await visible(page.getByRole('heading', { name: /Bonjour,/ }), 'Login must load the member dashboard.');
  // Let the initial emulator subscriptions finish before navigating away.
  // Aborting their first WebChannel handshake otherwise triggers the SDK’s
  // external connectivity diagnostic pixel during fixture setup.
  await eventually(() => page.locator('.portal-loading').count(), count => count === 0, 'Initial dashboard data must finish loading before fixture navigation.');
}

function trackPage(page, errors, external, details) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      // Record no request query/body: neither tokens nor passwords enter reports.
      external.add(url.hostname);
      details.push({ host: url.hostname, path: url.pathname, method: request.method(), type: request.resourceType() });
    }
  });
}

async function noOverflow(page, widths, measurements, view) {
  await page.evaluate(() => document.fonts.ready);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const result = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    measurements.push({ view, ...result });
    assert(result.scrollWidth <= result.clientWidth, `${view} has horizontal overflow at ${width}px: ${JSON.stringify(result)}`);
  }
}

async function screenshot(page, file) {
  // Chromium full-page captures otherwise include off-screen fixed elements
  // relative to the previous scroll position, including the hidden skip link.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/${file}`, fullPage: true });
}

test('signup, admin activation, protected content and live member updates', { timeout: 180_000 }, async () => {
  requireEmulators();
  const report = { projectId, checks: [], measurements: [], errors: [], externalHosts: [], externalRequests: [], result: 'running' };
  const external = new Set();
  const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const adminEmail = `admin-${runId}@example.test`;
  const memberEmail = `member-${runId}@example.test`;
  const password = `Test-${randomBytes(18).toString('base64url')}`;
  const name = 'E2E Nouveau Membre';
  const changedName = 'E2E Membre Modifié';
  const announcementTitle = `Nouveauté ${runId}`;
  const videoTitle = 'Comprendre XAUUSD depuis zéro';
  const videoUrl = 'https://example.com/members/video-basics';
  const brokerUrl = 'https://example.com/broker?affiliate=xauusd';
  const downloadUrl = 'https://example.com/application';
  const app = initializeApp({ projectId }, `portal-e2e-${runId}`);
  const store = getFirestore(app);
  let browser;
  let memberPage;
  let adminPage;
  let memberUid;
  let adminUid;

  async function check(description, action) {
    const started = Date.now();
    await action();
    report.checks.push({ description, passed: true, durationMs: Date.now() - started });
    console.log(`PASS: ${description}`);
  }

  try {
    await mkdir(artifacts, { recursive: true });
    const admin = await getAuth(app).createUser({ email: adminEmail, password, displayName: 'E2E Admin' });
    adminUid = admin.uid;
    await getAuth(app).setCustomUserClaims(admin.uid, { admin: true });
    await store.doc(`users/${admin.uid}`).set({
      displayName: 'E2E Admin', email: adminEmail,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });

    const options = { headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' };
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxyUrl) {
      const proxy = new URL(proxyUrl);
      options.proxy = { server: `${proxy.protocol}//${proxy.host}`, bypass: '127.0.0.1,localhost,[::1]' };
      if (proxy.username) options.proxy.username = decodeURIComponent(proxy.username);
      if (proxy.password) options.proxy.password = decodeURIComponent(proxy.password);
    }
    browser = await chromium.launch(options);
    const administrator = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const member = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    for (const context of [administrator, member]) {
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? route.continue() : route.abort();
      });
    }
    adminPage = await administrator.newPage();
    memberPage = await member.newPage();
    trackPage(adminPage, report.errors, external, report.externalRequests);
    trackPage(memberPage, report.errors, external, report.externalRequests);
    await login(adminPage, adminEmail, password);
    await adminPage.goto(`${origin}/admin`, { waitUntil: 'domcontentloaded' });
    await visible(adminPage.getByRole('heading', { name: 'Tous vos membres', exact: true }), 'Admin directory must load.');

    await check('registration validates email, password and name before creating an account', async () => {
      await memberPage.goto(`${origin}/connexion`, { waitUntil: 'domcontentloaded' });
      await visible(memberPage.getByRole('heading', { name: 'Heureux de vous revoir.', exact: true }), 'The login form must finish loading.');
      await screenshot(memberPage, 'portal-auth-desktop.png');
      await memberPage.setViewportSize({ width: 390, height: 844 });
      await screenshot(memberPage, 'portal-auth-mobile.png');
      await memberPage.setViewportSize({ width: 1440, height: 1000 });
      await memberPage.getByRole('button', { name: 'Créer un compte', exact: true }).click();
      const submit = memberPage.getByRole('button', { name: 'Créer mon compte', exact: true });
      const email = memberPage.getByLabel('Adresse e-mail', { exact: true });
      const pass = memberPage.getByLabel(/^Mot de passe/);
      const fullName = memberPage.getByLabel('Votre nom', { exact: true });
      let signups = 0;
      memberPage.on('request', request => { if (request.url().includes('accounts:signUp')) signups += 1; });
      await fullName.fill(name);
      await email.fill('adresse-invalide');
      await pass.fill(password);
      await submit.click();
      assert.equal(await email.evaluate(input => input.checkValidity()), false);
      assert.equal(signups, 0);
      await email.fill(memberEmail);
      await pass.fill('court');
      await submit.click();
      assert.equal(await pass.evaluate(input => input.checkValidity()), false);
      assert.equal(signups, 0);
      await pass.fill(password);
      await fullName.fill('  ');
      await submit.click();
      await visible(memberPage.getByRole('alert'), 'A whitespace-only name must be rejected.');
      assert.match(await memberPage.getByRole('alert').innerText(), /au moins 2 caractères/);
      assert.equal(signups, 0);
      await noOverflow(memberPage, [1440, 768, 390, 320], report.measurements, 'registration');
      await memberPage.setViewportSize({ width: 1440, height: 1000 });
      await fullName.fill(name);
      await submit.focus();
      await memberPage.keyboard.press('Enter');
      await memberPage.waitForURL(`${origin}/dashboard`);
      memberUid = (await getAuth(app).getUserByEmail(memberEmail)).uid;
      assert.equal(signups, 1);
    });

    await check('new users see the 2000 DH paywall and WhatsApp message with their email', async () => {
      const pay = memberPage.getByRole('link', { name: 'Payer et demander l’activation', exact: true });
      await visible(pay, 'A newly registered member must remain pending.');
      assert.match(await memberPage.locator('.access-price').innerText(), /2\s*000\s*DH/);
      const url = new URL(await pay.getAttribute('href'));
      assert.equal(url.origin, 'https://wa.me');
      assert.equal(url.pathname, '/212751019600');
      assert(url.searchParams.get('text').includes(memberEmail), 'Activation message must identify the signed-in email.');
      assert.equal(await memberPage.getByRole('region', { name: 'Vos trois espaces XAUUSD', exact: true }).count(), 0);
      assert.equal((await store.doc(`entitlements/${memberUid}`).get()).exists, false, 'Signup must not grant an entitlement.');
      await visible(adminPage.getByRole('row').filter({ hasText: memberEmail }), 'The already-open admin directory must receive the newly registered member.');
      await screenshot(memberPage, 'portal-pending-desktop.png');
      await memberPage.setViewportSize({ width: 390, height: 844 });
      await screenshot(memberPage, 'portal-pending-mobile.png');
      await memberPage.setViewportSize({ width: 1440, height: 1000 });
    });

    await check('a normal member cannot enter the administrator page', async () => {
      await memberPage.goto(`${origin}/admin`, { waitUntil: 'domcontentloaded' });
      await visible(memberPage.getByRole('heading', { name: 'Accès réservé.', exact: true }), 'The user must receive an access refusal.');
      assert.equal(await memberPage.getByRole('heading', { name: 'Tous vos membres', exact: true }).count(), 0);
      assert.equal(await memberPage.getByRole('button', { name: /^Activer l’accès de/ }).count(), 0);
      await memberPage.goto(`${origin}/dashboard`, { waitUntil: 'domcontentloaded' });
      await visible(memberPage.getByRole('link', { name: 'Payer et demander l’activation', exact: true }), 'Member must still have pending access.');
    });

    let memberNavigations = 0;
    memberPage.on('framenavigated', frame => { if (frame === memberPage.mainFrame()) memberNavigations += 1; });

    await check('admin activates access and member content appears live without reload', async () => {
      await adminPage.getByRole('button', { name: `Activer l’accès de ${memberEmail}`, exact: true }).click();
      await visible(memberPage.getByRole('region', { name: 'Vos trois espaces XAUUSD', exact: true }), 'Active users must see all three spaces immediately.');
      assert.equal(await memberPage.locator('.member-spaces > article').count(), 3);
      assert.equal(await memberPage.getByRole('link', { name: 'Payer et demander l’activation', exact: true }).count(), 0);
      assert.equal((await store.doc(`entitlements/${memberUid}`).get()).data().status, 'active');
      assert.equal(memberNavigations, 0, 'Activation must update through the live subscription.');
    });

    await check('admin configures video, broker and application links seen live by active members', async () => {
      await adminPage.getByRole('button', { name: 'Contenus', exact: true }).click();
      await adminPage.getByLabel('Présentation', { exact: true }).fill('Des vidéos explicatives pour bien démarrer avec votre espace XAUUSD.');
      await adminPage.getByRole('button', { name: '+ Ajouter une vidéo', exact: true }).click();
      await adminPage.getByLabel('Titre de la vidéo', { exact: true }).last().fill(videoTitle);
      await adminPage.getByLabel('Lien HTTPS', { exact: true }).last().fill(videoUrl);
      await adminPage.getByLabel(/^Lien du broker/).fill(brokerUrl);
      await adminPage.getByLabel('Lien de l’application — facultatif', { exact: true }).fill(downloadUrl);
      await adminPage.getByRole('button', { name: 'Enregistrer les contenus', exact: true }).click();
      await visible(adminPage.getByRole('status').filter({ hasText: 'Les contenus ont été enregistrés.' }), 'Content changes must be saved successfully.');
      const video = memberPage.getByRole('link', { name: new RegExp(videoTitle) });
      const broker = memberPage.getByRole('link', { name: 'Accéder au broker', exact: true });
      await visible(video, 'A video must appear in the member space.');
      await visible(broker, 'Broker link must appear in the member space.');
      assert.equal(await video.getAttribute('href'), videoUrl);
      assert.equal(await broker.getAttribute('href'), brokerUrl);
      assert.equal(await memberPage.getByRole('link', { name: 'Lien de l’application', exact: true }).getAttribute('href'), downloadUrl);
      for (const link of [video, broker]) {
        assert.equal(await link.getAttribute('target'), '_blank');
        assert((await link.getAttribute('rel')).includes('noopener'));
      }
      const pushTile = memberPage.locator('.notification-space');
      await eventually(() => pushTile.innerText(), text => /configur|disponible|indisponible|préparation/i.test(text), 'Absent VAPID must show an honest unconfigured notification state.');
      const pushButton = pushTile.getByRole('button', { name: /activer.*notification|activer.*alerte/i });
      if (await pushButton.count()) assert.equal(await pushButton.isDisabled(), true, 'Push activation cannot be offered without a VAPID key.');
      assert.equal(memberNavigations, 0, 'Settings must arrive without a page reload.');
    });

    await check('admin publishes an announcement received immediately by the member', async () => {
      await adminPage.getByRole('button', { name: 'Annonces', exact: true }).click();
      await adminPage.getByLabel('Titre', { exact: true }).fill(announcementTitle);
      await adminPage.getByLabel('Message', { exact: true }).fill('Une mise à jour de vos contenus est maintenant disponible dans votre espace membre.');
      await adminPage.getByRole('button', { name: 'Publier l’annonce', exact: true }).click();
      await visible(adminPage.getByRole('status').filter({ hasText: /Annonce publiée/ }), 'Announcement publication must succeed.');
      await visible(memberPage.getByRole('heading', { name: announcementTitle, exact: true }), 'The member must receive the newly published announcement live.');
      await visible(adminPage.getByRole('status').filter({ hasText: 'L’annonce reste publiée. L’envoi push est indisponible' }).first(), 'The absent Vite push API must preserve publication and explain unavailable delivery.');
      assert.equal(memberNavigations, 0, 'Announcements must arrive without a page reload.');
    });

    await check('profile edits propagate to the live admin directory', async () => {
      await adminPage.getByRole('button', { name: /^Membres/ }).click();
      await memberPage.getByRole('button', { name: 'Modifier mon nom', exact: true }).click();
      await memberPage.getByLabel('Nom complet', { exact: true }).fill(changedName);
      await memberPage.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      const row = adminPage.getByRole('row').filter({ hasText: memberEmail });
      await eventually(() => row.innerText(), text => text.includes(changedName), 'The admin must see the new profile name without reload.');
      assert.equal(memberNavigations, 0);
      await noOverflow(memberPage, [1440, 1024, 768, 390, 360, 320], report.measurements, 'active-dashboard');
      await memberPage.setViewportSize({ width: 390, height: 844 });
      await screenshot(memberPage, 'portal-member-mobile.png');
      await memberPage.setViewportSize({ width: 1440, height: 1000 });
      await screenshot(memberPage, 'portal-member-desktop.png');
      await noOverflow(adminPage, [1440, 768, 390, 320], report.measurements, 'admin-directory');
      await adminPage.setViewportSize({ width: 1440, height: 1000 });
      await screenshot(adminPage, 'portal-admin-desktop.png');
    });

    await check('admin suspension removes protected content immediately and records access history', async () => {
      await adminPage.getByRole('button', { name: `Suspendre l’accès de ${memberEmail}`, exact: true }).click();
      await visible(memberPage.getByRole('link', { name: 'Contacter le support', exact: true }), 'Suspended users must see their support paywall.');
      await eventually(() => memberPage.locator('.member-spaces').count(), count => count === 0, 'Suspension must immediately remove all protected spaces.');
      assert.equal(await memberPage.getByRole('link', { name: new RegExp(videoTitle) }).count(), 0);
      assert.equal(await memberPage.getByRole('link', { name: 'Accéder au broker', exact: true }).count(), 0);
      assert.equal((await store.doc(`entitlements/${memberUid}`).get()).data().status, 'suspended');
      await eventually(() => memberPage.locator('.history-list li').count(), count => count === 2, 'Activation and suspension must both appear in the member history.');
      const history = await store.collection('auditLogs').where('memberUid', '==', memberUid).get();
      assert.equal(history.size, 2);
      assert.deepEqual(history.docs.map(item => item.data().status).sort(), ['active', 'suspended']);
      assert.equal(memberNavigations, 0, 'Suspension must be received live.');
    });

    assert.deepEqual(report.errors, [], 'The portal must not throw browser errors.');
    assert.deepEqual([...external], [], 'Local E2E must not call live Firebase or external services.');
    report.result = 'passed';
  } catch (error) {
    report.result = 'failed';
    report.failure = error.message;
    await Promise.allSettled([
      memberPage?.screenshot({ path: `${artifacts}/portal-failure-member.png`, fullPage: true }),
      adminPage?.screenshot({ path: `${artifacts}/portal-failure-admin.png`, fullPage: true }),
    ]);
    throw error;
  } finally {
    report.externalHosts = [...external];
    await browser?.close();
    // Emulator-only cleanup; retain settings for inspection, remove test users.
    await Promise.allSettled([
      memberUid ? getAuth(app).deleteUser(memberUid) : Promise.resolve(),
      adminUid ? getAuth(app).deleteUser(adminUid) : Promise.resolve(),
    ]);
    await deleteApp(app);
    await writeFile(`${artifacts}/portal-e2e-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  }
});
