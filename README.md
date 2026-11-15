# Hysteria

Appli de suivi du groupe : répertoire (pochettes, tempo, tonalité, niveau de chacun), setlists de concert avec transitions, click intégré, agenda des dispos et inventaire du matos. Tout est synchronisé entre Achille, Quentin, Mathieu et Pierre.

## Mise en ligne (une seule fois, environ 5 min)

L'appli a besoin d'une petite fonction serveur pour partager les données, donc on passe par GitHub plutôt que par le glisser-déposer Netlify.

1. Sur github.com, crée un nouveau dépôt (par exemple `hysteria`, il peut être privé).
2. Dans le dépôt vide, clique sur « uploading an existing file » et glisse **le contenu** du dossier dézippé : `public`, `netlify`, `netlify.toml`, `package.json`, `package-lock.json`. Valide avec « Commit changes ».
3. Sur app.netlify.com : « Add new project », puis « Import an existing project », choisis GitHub et le dépôt `hysteria`. Ne change aucun réglage et clique sur « Deploy ».
4. Une fois le déploiement terminé, envoie l'adresse du site aux trois autres. Chacun choisit son prénom à la première ouverture.

Astuce : sur iPhone, Partager puis « Sur l'écran d'accueil » pour l'avoir comme une appli.

## Code d'accès (facultatif)

Par défaut, toute personne qui a le lien peut modifier. Pour ajouter un code :
Netlify, puis « Project configuration », « Environment variables », ajoute `BAND_CODE` avec le code de ton choix, puis relance un déploiement (« Deploys », « Trigger deploy »). L'appli demandera le code à chacun une fois.

## Modifier l'appli plus tard

Change les fichiers dans le dépôt GitHub : Netlify redéploie tout seul. Les données du groupe ne sont pas effacées par un redéploiement.

## Contenu

- `public/` : l'appli (HTML, CSS, JS)
- `public/shared.mjs` : la setlist de départ et la logique de modification des données
- `netlify/functions/state.mjs` : la fonction qui lit et écrit les données partagées (Netlify Blobs)
- `netlify/functions/search.mjs` : la recherche de morceaux et de pochettes (Deezer, iTunes en secours), sans clé à configurer
