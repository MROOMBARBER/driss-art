export class FirebaseConfigurationError extends Error {
  constructor() {
    super('Firebase server credentials are unavailable.');
    this.name = 'FirebaseConfigurationError';
  }
}

let servicesPromise;

/** Secrets stay on the server. A client Firebase config is never a server credential. */
async function initializeServices() {
  const emulatorVariables = [
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIREBASE_DATABASE_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
  ];
  if (emulatorVariables.some((name) => process.env[name])) {
    throw new FirebaseConfigurationError();
  }

  let phase = 'sdk_imports';
  try {
    const [{ applicationDefault, cert, getApps, initializeApp }, { getAuth }, firestore, { getMessaging }] =
      await Promise.all([
        import('firebase-admin/app'),
        import('firebase-admin/auth'),
        import('firebase-admin/firestore'),
        import('firebase-admin/messaging'),
      ]);

    phase = 'credential_validation';
    let projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serialized = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (serialized.length > 32768) throw new FirebaseConfigurationError();
      const account = JSON.parse(serialized);
      if (
        !account || account.type !== 'service_account' ||
        typeof account.project_id !== 'string' ||
        typeof account.client_email !== 'string' ||
        !account.client_email.endsWith('.iam.gserviceaccount.com') ||
        typeof account.private_key !== 'string' ||
        !account.private_key.startsWith('-----BEGIN PRIVATE KEY-----')
      ) throw new FirebaseConfigurationError();
      if (projectId && projectId !== account.project_id) throw new FirebaseConfigurationError();
      projectId = account.project_id;
      credential = cert(account);
    } else {
      credential = applicationDefault();
    }

    if (!projectId || !/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) {
      throw new FirebaseConfigurationError();
    }
    phase = 'credential_access_token';
    // applicationDefault() alone does not establish that ADC is usable.
    await credential.getAccessToken();
    phase = 'admin_app_initialization';
    const app = getApps().find((candidate) => candidate.name === 'driss-push-server') ||
      initializeApp({ credential, projectId }, 'driss-push-server');
    phase = 'admin_service_initialization';
    return {
      auth: getAuth(app),
      db: firestore.getFirestore(app),
      messaging: getMessaging(app),
      serverTimestamp: () => firestore.FieldValue.serverTimestamp(),
      documentId: firestore.FieldPath.documentId(),
    };
  } catch (error) {
    // Log only the fixed internal phase and a safe Firebase SDK error code.
    // NEVER log error.message, stack, credential content, account IDs or tokens.
    const safeCode = typeof error?.code === 'string' && /^[a-z0-9/_-]{1,80}$/i.test(error.code) ? error.code : 'unclassified';
    console.error('firebase_admin_init_failure', { phase, code: safeCode });
    throw new FirebaseConfigurationError();
  }
}

export async function getFirebaseServices() {
  if (!servicesPromise) {
    servicesPromise = initializeServices().catch((error) => {
      servicesPromise = undefined;
      throw error;
    });
  }
  return servicesPromise;
}
