# Прямая связь Spotify → EclipseIsland 0.5.0

Этот мост читает события и метаданные из самого Spotify через Spicetify. Задержка публикации в Windows Media Session не участвует в этом пути. Кнопки острова вызывают Player API расширения.

1. Запустите EclipseIsland 0.5.0 хотя бы один раз и оставьте его работать.
2. Установите Spicetify через обычный PowerShell:

```powershell
winget install Spicetify.Spicetify
```

3. Закройте PowerShell и откройте его заново. Убедитесь, что команда `spicetify` находится.
4. В EclipseIsland откройте «Музыка» → «Настроить Spotify» и запустите `Install.cmd` из открытой папки. Также можно запустить `Install.cmd` из этого архива. Он добавит `eclipse-island.js` в список расширений Spicetify и применит изменения к Spotify. Существующие расширения сохраняются.
5. Перезапустите Spotify. В настройках EclipseIsland → «Музыка» должно появиться **«Расширение подключено»**, а у трека — **«Прямая связь»**. Если этой надписи нет, прямой путь ещё не работает и используется Windows.

Скрипт рассчитан на стандартную папку `%APPDATA%\spicetify\Extensions`. При нестандартной конфигурации Spicetify скопируйте полученный файл `eclipse-island.js` в вашу папку Extensions и выполните `spicetify config extensions eclipse-island.js`, затем `spicetify apply`.

Локальный токен берётся из настроек EclipseIsland на вашем компьютере. Его не нужно отправлять в чат. Сервер слушает только `127.0.0.1:43119`; аккаунтные токены Spotify не используются.

Установка Spicetify: https://spicetify.app/docs/getting-started
Расширения: https://spicetify.app/docs/customization/extensions

Удаление только этого расширения:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-Spotify-Bridge.ps1 -Remove
```

Реальные задержки на Windows необходимо измерить после установки. Название передаётся при событии смены трека; загрузка ещё не закэшированной обложки может зависеть от сети.
