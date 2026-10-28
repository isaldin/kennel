import type { Translation } from './types'

export const en = {
  'rules.staleImage.title': {
    one: 'Image {name} not updated for {count} day',
    other: 'Image {name} not updated for {count} days'
  },
  'rules.staleImage.explanation': {
    one: 'Container {name} runs image {image}, built {count} day ago.',
    other: 'Container {name} runs image {image}, built {count} days ago.'
  },
  'rules.staleImage.question': 'Is this service still needed? If so, rebuild or update it.',
  'rules.staleImage.action': 'Update the image or remove the container',
  'rules.noTraffic.title': {
    one: '{domain}: no requests for {count} day',
    other: '{domain}: no requests for {count} days'
  },
  'rules.noTraffic.explanation': {
    one: 'The access log of {domain} has not changed for {count} day.',
    other: 'The access log of {domain} has not changed for {count} days.'
  },
  'rules.noTraffic.question': 'Is anyone using this site?',
  'rules.noTraffic.action': 'Turn the site off or check DNS',
  'rules.crashloop.title': '{name} keeps restarting',
  'rules.crashloop.grew':
    'The restart count grew from {before} to {after} since the last snapshot.',
  'rules.crashloop.restarting': 'The container is in the restarting state.',
  'rules.crashloop.action': 'Check the container logs',
  'rules.publicPort.title': 'Port {port} is open to the internet',
  'rules.publicPort.explanation':
    '{process} listens on {address}:{port}. Databases and caches usually should not be reachable from the internet.',
  'rules.publicPort.process': 'A process',
  'rules.publicPort.action': 'Bind it to 127.0.0.1 or close it with a firewall',
  'rules.unknown.question': 'What is this, and is it needed?',
  'rules.unknownContainer.title': 'Unknown container {name}',
  'rules.unknownContainer.explanation':
    'Container {name} ({image}, {state}) is not in the service registry.',
  'rules.unknownUnit.title': 'Unknown service {name}',
  'rules.unknownUnit.explanation':
    'systemd unit {name} ({state}) was installed by hand and is not in the registry.',
  'rules.missing.title': '{name} is not running',
  'rules.missing.explanation':
    'Service {name} ({kind}) is marked as expected to run, but it is not among the running ones.',
  'rules.missing.action': 'Check and restart it, or clear the "expected to run" flag',
  'rules.idle.title': 'Server {name} is idle',
  'rules.idle.explanation': {
    one: 'Average load over {count} snapshot: RAM {ram}%, CPU {cpu}%, while it costs {cost} {currency}/mo.',
    other:
      'Average load over {count} snapshots: RAM {ram}%, CPU {cpu}%, while it costs {cost} {currency}/mo.'
  },
  'rules.idle.question': 'Can the services move to another server so this one can be deleted?',
  'rules.idle.action': 'Consider consolidating',
  'rules.ssl.expired': 'Certificate for {domain} has expired',
  'rules.ssl.expiring': {
    one: 'Certificate for {domain} expires in {count} day',
    other: 'Certificate for {domain} expires in {count} days'
  },
  'rules.ssl.explanation': 'The certificate is valid until {notAfter}.',
  'rules.ssl.action': 'Check auto-renewal (certbot / Caddy / Traefik)',
  'rules.disk.title': 'Disk {mount} is {pct}% full',
  'rules.disk.explanation': '{used} of {size} bytes used.',
  'rules.disk.action': 'Clean up docker images / logs or grow the disk',
  'rules.duplicate.title': {
    one: '{repo} runs on {count} server',
    other: '{repo} runs on {count} servers'
  },
  'rules.duplicate.explanation': 'Image {repo} runs on: {servers}.',
  'rules.duplicate.question': 'Can one instance be enough?',
  'rules.duplicate.action': 'Consider merging them'
}

export const ru: Translation<typeof en> = {
  'rules.staleImage.title': 'Образ {name} не обновлялся {count} дн.',
  'rules.staleImage.explanation':
    'Контейнер {name} запущен из образа {image}, собранного {count} дней назад.',
  'rules.staleImage.question':
    'Этот сервис ещё нужен? Если да, его стоит пересобрать или обновить.',
  'rules.staleImage.action': 'Обновить образ или удалить контейнер',
  'rules.noTraffic.title': '{domain}: нет запросов {count} дн.',
  'rules.noTraffic.explanation': 'Access log сайта {domain} не менялся {count} дней.',
  'rules.noTraffic.question': 'Сайтом кто-то пользуется?',
  'rules.noTraffic.action': 'Отключить сайт или проверить DNS',
  'rules.crashloop.title': '{name} перезапускается',
  'rules.crashloop.grew': 'Счётчик перезапусков вырос с {before} до {after} с прошлого снимка.',
  'rules.crashloop.restarting': 'Контейнер в состоянии restarting.',
  'rules.crashloop.action': 'Посмотреть логи контейнера',
  'rules.publicPort.title': 'Порт {port} открыт наружу',
  'rules.publicPort.explanation':
    '{process} слушает {address}:{port}. Базы и кэши обычно не должны быть доступны из интернета.',
  'rules.publicPort.process': 'Процесс',
  'rules.publicPort.action': 'Привязать к 127.0.0.1 или закрыть фаерволом',
  'rules.unknown.question': 'Что это и нужно ли оно?',
  'rules.unknownContainer.title': 'Неизвестный контейнер {name}',
  'rules.unknownContainer.explanation':
    'Контейнер {name} ({image}, {state}) не записан в реестр сервисов.',
  'rules.unknownUnit.title': 'Неизвестный сервис {name}',
  'rules.unknownUnit.explanation':
    'systemd unit {name} ({state}) установлен вручную и не записан в реестр.',
  'rules.missing.title': '{name} не работает',
  'rules.missing.explanation':
    'Сервис {name} ({kind}) отмечен как обязательный, но не найден среди работающих.',
  'rules.missing.action': 'Проверить и перезапустить, или снять пометку «должен работать»',
  'rules.idle.title': 'Сервер {name} простаивает',
  'rules.idle.explanation':
    'Средняя загрузка за {count} снимк.: RAM {ram}%, CPU {cpu}%, при этом он стоит {cost} {currency}/мес.',
  'rules.idle.question': 'Можно перенести сервисы на другой сервер и удалить этот?',
  'rules.idle.action': 'Рассмотреть консолидацию',
  'rules.ssl.expired': 'Сертификат {domain} истёк',
  'rules.ssl.expiring': 'Сертификат {domain} истекает через {count} дн.',
  'rules.ssl.explanation': 'Срок действия сертификата: {notAfter}.',
  'rules.ssl.action': 'Проверить автопродление (certbot / Caddy / Traefik)',
  'rules.disk.title': 'Диск {mount} заполнен на {pct}%',
  'rules.disk.explanation': 'Занято {used} из {size} байт.',
  'rules.disk.action': 'Почистить docker images / логи или расширить диск',
  'rules.duplicate.title': '{repo} запущен на {count} серверах',
  'rules.duplicate.explanation': 'Образ {repo} работает на: {servers}.',
  'rules.duplicate.question': 'Можно оставить один экземпляр?',
  'rules.duplicate.action': 'Рассмотреть объединение'
}
