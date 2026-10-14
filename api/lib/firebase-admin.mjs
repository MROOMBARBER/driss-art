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

  try {
    const [{ applicationDefault, cert, getApps, initializeApp }, { getAuth }, firestore, { getMessaging }] =
      await Promise.all([
        import('firebase-admin/app'),
        import('firebase-admin/auth'),
        import('firebase-admin/firestore'),
        import('firebase-admin/messaging'),
      ]);

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
    // applicationDefault() alone does not establish that ADC is usable.
    await credential.getAccessToken();
    const app = getApps().find((candidate) => candidate.name === 'driss-push-server') ||
      initializeApp({ credential, projectId }, 'driss-push-server');
    return {
      auth: getAuth(app),
      db: firestore.getFirestore(app),
      messaging: getMessaging(app),
      serverTimestamp: () => firestore.FieldValue.serverTimestamp(),
      documentId: firestore.FieldPath.documentId(),
    };
  } catch {
    // Credential parser, OAuth, SDK and filesystem errors may contain secrets.
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
