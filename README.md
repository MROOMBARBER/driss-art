# XAUUSD

Site statique en darija et arabe pour une seule offre : **application XAUUSD, 2000 DH, accès à vie**. Les demandes d'achat passent par WhatsApp au **+212 751 019 600**.

## Développement

Depuis le dépôt, avec Python 3 :

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory .
```

Aucune installation npm, compilation, base de données ou clé secrète n'est nécessaire.

- `index.html` : contenu, métadonnées, offre et liens WhatsApp.
- `styles.css` : styles et mises en page mobile/ordinateur.
- `script.js` : menu mobile et année du pied de page.
- `assets/` : illustration originale, favicon et polices locales avec leurs licences.

L'illustration d'interface est un concept visuel, pas une capture du produit. Les liens WhatsApp ouvrent un message prérempli ; aucun message n'est envoyé automatiquement.

## Validation

Vérifier l'absence de débordement horizontal sur mobile, la présence d'une seule offre à 2000 DH à vie, l'ouverture du menu et sa fermeture avec Échap, la FAQ au clavier et la destination des boutons WhatsApp. Le contenu, les liens et la FAQ restent disponibles sans JavaScript. Les animations respectent la préférence de réduction des mouvements.

## Hébergement

Le site peut être servi directement par GitHub Pages ou tout hébergement statique. `CNAME` conserve le domaine `drissart.com`. Les modifications locales ne publient pas automatiquement le site en ligne.
