@echo off
chcp 65001 >nul
rem ================================================================
rem  Запуск стенда «Путь зерна» на тач-панели 3840x2160.
rem  Положите этот файл рядом с app.html (единое приложение одним
rem  файлом, лежит в сборке: dist\app\index.html — переименуйте в
rem  app.html) и запускайте двойным щелчком или из автозагрузки.
rem  Выход из режима киоска: Alt+F4 с клавиатуры.
rem ================================================================

set "APP=%~dp0app.html"
if not exist "%APP%" (
  echo Не найден файл app.html рядом с этим ярлыком.
  pause
  exit /b 1
)

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Не найден Google Chrome. Установите его и запустите ярлык снова.
  pause
  exit /b 1
)

rem отдельный профиль: без расширений, без восстановления вкладок и подсказок
set "PROFILE=%~dp0chrome-profile"

start "" "%CHROME%" ^
  --kiosk "file:///%APP:\=/%" ^
  --user-data-dir="%PROFILE%" ^
  --no-first-run --no-default-browser-check ^
  --disable-pinch --overscroll-history-navigation=0 ^
  --disable-features=Translate,TouchpadOverscrollHistoryNavigation,InfiniteSessionRestore ^
  --disable-session-crashed-bubble --disable-infobars ^
  --autoplay-policy=no-user-gesture-required ^
  --allow-file-access-from-files ^
  --enable-gpu-rasterization --ignore-gpu-blocklist ^
  --force-device-scale-factor=1
