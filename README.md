# Stacklab

Stacklab propose six quiz en français sur Docker, Ansible, le DevOps, la CI/CD, la gestion du code et l’usine logicielle. Le score et les corrections s’affichent à la fin de chaque quiz.

- [Stacklab](https://stacklab.vjuya.me/)
- [Maquette Figma](https://www.figma.com/design/VUrXRbpLaHMBzrc86ENHqt?node-id=4-166)

## Démarrer en local

Copiez `.env.example` vers `.env`, renseignez les valeurs locales, puis lancez `docker compose up -d --build --wait`. Ouvrez [le quiz](http://localhost:8087/) ou [l’administration](http://localhost:8087/gestion-quiz).

Compose relie Nginx, Express et PostgreSQL. Pour activer les e-mails, configurez `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN` et `FROM_EMAIL`. Le score s’enregistre aussi quand l’envoi est désactivé. La configuration de production est gérée dans le namespace Stacklab, séparément des sources.

GitHub Actions construit et scanne les images web et API, puis publie les images de `main` dans GHCR avec le SHA du commit. Argo CD applique les manifests du dépôt GitOps de Sunny.

Stacklab reprend le projet [Quiz App](https://github.com/franklin-tutorials/eval-quiz-app). Les polices auto-hébergées sont distribuées sous licence SIL Open Font License, avec leurs notices dans `public/stacklab/`.
