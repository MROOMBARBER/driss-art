# XAUUSD — site et espace membre

Une seule offre : **application XAUUSD, 2000 DH, accès à vie**. Le site public conserve son design noir/or et son domaine `drissart.com`. L’espace membre utilise **Firebase Authentication**, **Cloud Firestore** et **Firebase Cloud Messaging**. Vercel sert le site et l’API d’envoi push.

## Parcours

1. L’utilisateur crée un compte e-mail/mot de passe sur `/connexion?mode=register`.
2. Son accès reste **en attente**. `/dashboard` indique le prix et ouvre WhatsApp avec son e-mail dans le message.
3. Un administrateur vérifie le paiement et active l’utilisateur depuis `/admin`.
4. Son dashboard s’actualise automatiquement et affiche trois espaces : **vidéos depuis zéro**, **broker affilié**, **activation des notifications push**.
5. L’administrateur gère les vidéos, le lien broker, les annonces, les statuts et l’historique. La suspension retire immédiatement les contenus protégés du dashboard.

Le paiement est confirmé manuellement par l’administrateur. Le site ne traite pas de carte bancaire et ne marque pas une inscription comme payée automatiquement. Aucun broker, aucune vidéo et aucun compte de production ne sont inventés.

## Développement

Prérequis : **Node.js 24**, npm ; **Java 21** et Chromium pour les tests intégrés.

```sh
npm ci
npm run dev
```

Sans configuration Firebase, le site public fonctionne et l’espace membre indique qu’il est en préparation. Pour connecter un vrai projet, copier `.env.example` vers `.env.local`, puis renseigner les identifiants web publics. Ne jamais mettre une clé privée dans une variable `VITE_`.

```sh
npm run build
npm run preview
```

Le build produit le site, les pages `/connexion`, `/dashboard`, `/admin` et le service worker FCM dans `dist/`. Les routes sont déclarées dans `vercel.json`. L’API serveur demeure dans `api/`.

## Tests Firebase locaux

Le mode émulateur utilise uniquement le projet réservé `demo-xauusd`. Les émulateurs sont refusés pour un ID de projet réel en développement. Ils ne sont jamais activés par le code en production.

```sh
npm run test:rules
npm run test:api
npm run test:e2e
```

Les tests vérifient l’isolation des utilisateurs, les droits administrateur, la protection des contenus et tokens push, les changements audités, l’inscription, l’activation en temps réel, les vidéos et le broker, les annonces, la suspension et les vues mobile/ordinateur. Les tests API vérifient les refus d’accès, les destinataires actifs, l’idempotence et les erreurs FCM. Les émulateurs Firebase ne simulent pas la livraison FCM sur un vrai appareil.

Dans le cloud Codex, les caches doivent rester dans les dossiers autorisés :

```sh
export XDG_CONFIG_HOME=/workspace/.config
export XDG_CACHE_HOME=/workspace/.cache
export FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators
npm ci --cache /workspace/.npm --no-audit --no-fund
npm run test:rules
npm run test:api
npm run test:e2e
```

## Configuration Firebase de production

Créer un projet Firebase dédié à XAUUSD, distinct des autres applications et de leurs utilisateurs.

1. Ajouter une application **Web** et récupérer sa configuration publique.
2. Activer **Authentication → E-mail/Mot de passe** ; ajouter le domaine Vercel et le domaine final aux domaines autorisés.
3. Créer **Cloud Firestore**, choisir sa région, puis déployer `firestore.rules` et `firestore.indexes.json` :

```sh
npx firebase deploy --project VOTRE_PROJECT_ID --only firestore:rules,firestore:indexes
```

4. Dans **Cloud Messaging → Web Push certificates**, générer la clé VAPID publique.
5. Fournir les variables publiques au build Vercel :

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_VAPID_KEY
```

`VITE_USE_FIREBASE_EMULATORS` doit rester absent ou `false` en production. Les règles de base doivent être déployées avant d’ouvrir les inscriptions.

## Administrateur

Créer le compte administrateur avec un e-mail qui appartient au propriétaire, relever son UID Firebase Authentication, puis attribuer le claim sur une machine d’opérateur disposant de vrais **Application Default Credentials** ou du **FIREBASE_TOKEN** injecté de manière sécurisée et autorisé pour ce projet :

```sh
node scripts/set-admin.mjs --uid FIREBASE_USER_UID --project VOTRE_PROJECT_ID
```

Le script préserve les autres claims. La personne doit ensuite se déconnecter/reconnecter pour renouveler son jeton. Le rôle ne peut jamais être attribué par un champ de profil, une URL, le premier utilisateur inscrit ou le navigateur.

Pour supprimer le rôle :

```sh
node scripts/set-admin.mjs --uid FIREBASE_USER_UID --project VOTRE_PROJECT_ID --remove
```

La suppression révoque les jetons de rafraîchissement ; les anciens ID tokens peuvent rester valides jusqu’à leur expiration. L’API push vérifie aussi leur révocation.

## Vercel et notifications push

Le projet Vercel **driss-xauusd**, dans l’équipe **mamoun5**, est lié au dépôt GitHub. Le code déployé utilise Node.js 24 et `npm run build`. Les commits sur `main` peuvent déclencher ses déploiements via cette liaison.

Dans les variables **serveur** sécurisées du projet Vercel, renseigner :

```text
FIREBASE_PROJECT_ID
FIREBASE_SERVICE_ACCOUNT_JSON
APP_ORIGIN
```

`FIREBASE_SERVICE_ACCOUNT_JSON` contient la clé d’un compte de service dédié, autorisé à lire les utilisateurs Firebase Auth, à lire/écrire Firestore et à envoyer FCM. Elle doit rester exclusivement dans les paramètres sécurisés Vercel. Une vraie identité ADC serveur peut remplacer ce JSON si elle est effectivement configurée. `APP_ORIGIN` est l’origine HTTPS utilisée par le déploiement.

L’API `POST /api/admin/push` exige un ID token Firebase avec le claim `admin: true`. Elle diffuse une annonce existante seulement aux utilisateurs encore actifs et nettoie les tokens FCM invalides. Les tentatives sont suivies avec des reçus serveur pour limiter les doublons et permettre des reprises. Une interruption après acceptation FCM et avant l’écriture du reçu peut exceptionnellement rediffuser un message ; les compteurs indiquent l’acceptation par FCM, pas la lecture par un appareil.

Le membre choisit d’autoriser les notifications sur son appareil. Sur iPhone/iPad compatible, le site doit être ajouté à l’écran d’accueil. L’annonce reste disponible en temps réel même si l’envoi push n’est pas encore configuré.

Ne migrer le DNS de `drissart.com` vers Vercel qu’après une vérification du déploiement et des services Firebase. Le fichier `CNAME` existant n’effectue pas cette migration. Le site public GitHub Pages et le nouvel hébergement Vercel sont distincts.

## Organisation

- `index.html`, `styles.css`, `script.js` : site public.
- `portal.html`, `src/` : application membre/admin React et Firebase.
- `firestore.rules`, `firestore.indexes.json` : contrôles et index côté base.
- `api/` : envoi push serveur Vercel, aucune clé dans le bundle navigateur.
- `scripts/`, `tests/` : administration de confiance et validations.
- `assets/`, `public/` : polices locales avec licences, illustrations, manifest et icônes.

La connexion Firebase réelle, les domaines autorisés, les contenus et la livraison push doivent être vérifiés sur le projet configuré. La réussite des émulateurs ne prouve pas la connexion à un projet de production.

## Connexion administrateur dédiée

- Page sécurisée : `/admin/connexion` (e-mail + mot de passe, sans inscription admin publique).
- Dashboard réservé : `/admin`.
- Projet Firebase prévu pour cette application : `vipxauusd-f0693`. Vérifier que les variables Vercel `VITE_FIREBASE_PROJECT_ID` et les autres clés web utilisent **le même projet** avant de déployer.
- Dans **Firebase Console → Authentication → Users**, créer un utilisateur administrateur avec son propre e-mail et un mot de passe robuste. Ne jamais enregistrer ce mot de passe dans GitHub, le code source ou des variables `VITE_*`.
- Relever le **UID** de cet utilisateur, puis attribuer le Custom Claim `admin: true` avec `node scripts/set-admin.mjs --uid VOTRE_UID --project vipxauusd-f0693` depuis une machine opérateur disposant des autorisations Firebase appropriées (instructions précédentes dans ce README).
- Se déconnecter et se reconnecter pour renouveler le jeton. Les identifiants seuls ne donnent pas le droit d’administrer : Firestore Rules exigent également le Custom Claim.
- Les utilisateurs ordinaires ne peuvent ni accorder un rôle d’administration ni modifier les règles depuis le site.
