# MHM — Mental Health Matters (JLM · ENSAM Casablanca)

Site statique + une fonction Netlify (stockage Netlify Blobs). Aucune base de données à installer, aucune dépendance front.

## Mise en ligne
1. Envoie tout ce dossier dans un dépôt GitHub (index.html, netlify.toml, package.json, dossier netlify/).
2. Netlify → Add new site → Import an existing project → GitHub → ton dépôt → Deploy (commande de build vide).
3. Site configuration → Environment variables → ADMIN_PASSWORD = ton mot de passe modérateur → Deploys → Trigger deploy.
4. Vérifie https://TON-SITE.netlify.app/api/data → {"posts":[]}.

## Modération
Petit 🔒 en bas de page → ADMIN_PASSWORD → « Supprimer » sur une histoire ou sur un commentaire (vérifié côté serveur).

## Personnalisation
- Numéros d'urgence : constante EMERGENCY en haut du script de index.html (19 · 177 · 15 par défaut — à vérifier).
- Anti-spam : 20 s entre deux histoires, 6 s entre deux commentaires (par IP, dans netlify/functions/mhm.mjs).

## Fichiers
index.html (application) · netlify/functions/mhm.mjs (API) · netlify.toml (config + en-têtes de sécurité) · package.json.

Ouvert directement dans le navigateur (sans Netlify), le site passe en mode démo local.
