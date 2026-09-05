# Публикация на GitHub Pages

Проект готов к размещению под адресом вида `https://OWNER.github.io/REPOSITORY/`.
Все ссылки, импорты модулей и загрузки данных относительные; сборка не требуется.

1. Создать репозиторий и загрузить исходники, включая `dist` и `.github/workflows/pages.yml`.
2. В Settings → Pages → Build and deployment выбрать Source: GitHub Actions.
3. После push в `main` или `master` workflow публикует папку `dist`. Его также можно запустить через Actions → Publish grain atlas to GitHub Pages → Run workflow.
4. Публичный адрес появится в результате шага Publish и в Settings → Pages.

Для GitHub Free нужен публичный репозиторий. Приватные репозитории поддерживаются на соответствующих платных планах.
Секреты и отдельный токен для workflow не требуются: используются стандартные разрешения GITHUB_TOKEN и OIDC.

Исходники и зависимости находятся в папке проекта. Папка `.openai` относится только к текущему размещению в Sites и не нужна в новом GitHub-репозитории.

Документация: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

На момент подготовки этого файла публикация на GitHub ещё не выполнена: нужен целевой репозиторий с включёнными GitHub Pages.
