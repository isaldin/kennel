<div align="center">

<img src="build/icon.png" width="112" alt="Иконка Kennel">

# Kennel

**Личный менеджер VPS:** инвентарь серверов и расходов, SSH-терминал, пароли из Enpass только на чтение и AI-аудит каждого сервера через локальный Claude Code.

[![CI](https://github.com/isaldin/kennel/actions/workflows/ci.yml/badge.svg)](https://github.com/isaldin/kennel/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/isaldin/kennel?sort=semver)](https://github.com/isaldin/kennel/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/isaldin/kennel/total)](https://github.com/isaldin/kennel/releases)
[![License: MIT](https://img.shields.io/github/license/isaldin/kennel)](LICENSE)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)

[English](README.md) · Русский

</div>

> [!NOTE]
> Kennel разрабатывается и проверяется на macOS. Сборки под Windows и Linux собирает CI, но вручную их пока не тестировали.

## Возможности

- **Инвентарь.** Карточки серверов: провайдер, проект, стоимость в месяц и валюта, день оплаты, ссылка на панель, заметки. У каждого сервера есть список сервисов (Docker, Coolify, systemd, прочее) с URL и флагом «должен работать». Серверы можно импортировать из `~/.ssh/config`.
- **SSH-терминал.** ssh2 + xterm.js во вкладках. Порядок авторизации: ssh-agent, затем IdentityFile (или `~/.ssh/id_*`), затем пароль из привязанной записи Enpass. Ключи хостов сверяются с `~/.ssh/known_hosts`.
- **Enpass только на чтение.** Хранилище копируется во временную папку и открывается мастер-паролем, который живёт только в памяти. Пароли не попадают в интерфейс: они копируются в буфер обмена (очищается через 30 с) или сразу идут на SSH-логин.
- **Аудит сервера.** Read-only скрипт собирает по SSH снимок: сведения о хосте, диски, контейнеры и образы, юниты systemd, открытые порты, vhost'ы nginx/Caddy, метки Traefik, cron, TLS-сертификаты. Детерминированные правила находят устаревшие образы, падающие в цикле сервисы, публичные порты, неизвестные и пропавшие сервисы, простаивающие серверы, заполненные диски и истекающие сертификаты. Повторный аудит запускается по расписанию.
- **Анализ через Claude.** Снимок уходит в Claude Code CLI на вашей подписке. Claude объясняет, что где работает, и указывает на проблемы. Он может запросить дополнительные read-only команды из фиксированного allowlist, и каждая выполняется только после вашего подтверждения.
- **Чат по каждой находке.** Находку можно обсудить с Claude. Он отвечает командами, которые вы запускаете сами, и ничего не меняет на сервере.
- **Темы.** Тёмная, светлая, Nord, Solarized light, Gruvbox или системная, вместе с палитрой терминала.

## Скачать

Последняя сборка лежит в **[Releases](https://github.com/isaldin/kennel/releases/latest)**:

| Платформа             | Файл                         |
| --------------------- | ---------------------------- |
| macOS (Apple Silicon) | `kennel-<version>-arm64.dmg` |
| macOS (Intel)         | `kennel-<version>-x64.dmg`   |
| Windows               | `kennel-<version>-setup.exe` |
| Linux                 | `.AppImage` или `.deb`       |

### Первый запуск

Сборки пока не подписаны, поэтому при первом запуске ОС покажет предупреждение.

- **macOS:** если пишет, что приложение «повреждено» или «не может быть открыто», выполните
  ```bash
  xattr -cr /Applications/Kennel.app
  ```
  или откройте его через правый клик → **Открыть**.
- **Windows:** SmartScreen → **Подробнее** → **Выполнить в любом случае**.
- **Linux (AppImage):** `chmod +x kennel-*.AppImage` и запустите.

## Что нужно

- SSH-доступ к серверам. Сбор данных принимает только ключи хостов, которые уже есть в `~/.ssh/known_hosts`, поэтому сначала один раз подключитесь из терминала.
- По желанию: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI с выполненным входом, для AI-аудита и чатов. Без него аудит работает только на правилах. Kennel ищет `claude` в `PATH` login-шелла и в `~/.local/bin/claude`; другой путь задаётся через `KENNEL_CLAUDE_BIN`.
- По желанию: десктопный Enpass с локальным хранилищем.

## Безопасность

- **Enpass только на чтение.** Kennel никогда не пишет в хранилище. Мастер-пароль хранится только в памяти main-процесса.
- **SSH-ключи остаются в `~/.ssh`** и используются через ssh-agent или IdentityFile. В приложение они не копируются.
- **Claude не может ничего изменить на серверах.** У него нет своих инструментов, он может только _запросить_ команду из read-only allowlist (`docker logs/inspect`, `systemctl status`, `journalctl`, чтение конфигов, `ls`, `curl -I` к доменам самого сервера). Каждый запрос проверяется и выполняется только после вашего подтверждения. Секреты в выводе маскируются, а сам вывод обрезается до отправки модели.
- **В базе приложения нет паролей.** Локальная SQLite-база хранит инвентарь, результаты аудита и чаты и не шифруется. Учётные данные остаются в Enpass и `~/.ssh`.

## Разработка

```bash
npm install
npm run dev          # запуск с HMR
npm test             # vitest
npm run typecheck
npm run lint
npm run build:mac    # или build:win / build:linux
```

Стек: Electron, electron-vite, React 19, TypeScript, ssh2, xterm.js, better-sqlite3-multiple-ciphers.

### Выпуск релиза

1. Поднимите `version` в `package.json` и закоммитьте.
2. Поставьте тег и запушьте его: `git tag v0.1.0 && git push origin v0.1.0`.
3. [Release workflow](.github/workflows/release.yml) соберёт установщики для macOS, Windows и Linux и приложит их к черновику релиза.
4. Проверьте черновик на GitHub, напишите описание и опубликуйте.

## Лицензия

[MIT](LICENSE) © Ilya Saldin
