# Hysteria

Appli de suivi du groupe : répertoire (pochettes, tempo, tonalité, accordage, capo, niveau de chacun, accords et paroles affichés dans la fiche (avec transposition), liens vers accords, tablatures et paroles, grille du groupe), setlists de concert avec transitions, intermèdes et durée prévue, mode scène (défilement automatique, chrono, verrouillage) et version imprimable, click intégré, agenda des dispos (avec dispos récurrentes et ajout à l'agenda du téléphone), inventaire du matos et fiche technique imprimable, boîte à idées de morceaux avec votes, carnet de contacts, fil d'activité, bouton Annuler et mode nuit. Tout est synchronisé entre Achille, Quentin, Matthieu et Pierre.

## Mise en ligne

Tous les fichiers sont à plat (aucun dossier) : Netlify les range lui-même au moment de la mise en ligne.

1. Sur github.com, crée un dépôt et clique sur « uploading an existing file ».
2. Glisse tous les fichiers de ce dossier, puis « Commit changes ».
3. Sur app.netlify.com : « Add new project », « Import an existing project », GitHub, choisis le dépôt, puis « Deploy » sans rien changer.
4. Envoie l'adresse en .netlify.app aux trois autres. Chacun choisit son prénom à la première ouverture.


## Modifier l'appli plus tard

Change les fichiers dans le dépôt GitHub : Netlify redéploie tout seul. Les données du groupe ne sont pas effacées par un redéploiement.

## Contenu

- `index.html`, `app.js`, `style.css` : l'appli
- `shared.mjs` : le répertoire de départ et la logique de modification des données
- `state.mjs` : la fonction qui lit et écrit les données partagées (Netlify Blobs)
- `search.mjs` : la recherche de morceaux et de pochettes (Deezer, iTunes en secours), sans clé à configurer
- `cover.mjs` : relais des pochettes, pour que la fiche d'un morceau prenne la couleur de sa pochette
- `chords.mjs` : la grille d'accords avec paroles, récupérée à la demande sur Ultimate Guitar (version la mieux notée), rien n'est stocké
- `lyrics.mjs` : les paroles seules (LRCLIB, base libre), utilisées quand aucune grille d'accords n'est trouvée
- `ics.mjs` : le fichier d'agenda (.ics) d'une répète ou d'un concert, avec un rappel la veille

## Sauvegardes
Le serveur garde une copie des données par jour (prise avant la première modif de la journée), pendant 30 jours. On les retrouve dans le profil (bouton avec ton prénom), rubrique Sauvegarde, avec un bouton pour télécharger une copie complète en fichier.
