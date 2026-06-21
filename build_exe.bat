@echo off
rem Пересборка автономного .exe (без необходимости Python на целевой машине).
rem Требуется один раз:  py -m pip install pywebview pyinstaller
cd /d "%~dp0"
py -m PyInstaller --noconfirm --noconsole --name "FaceComposite" ^
  --icon "app.ico" ^
  --add-data "index.html;." ^
  --add-data "styles.css;." ^
  --add-data "js;js" ^
  --add-data "docs;docs" ^
  --add-data "models;models" ^
  --collect-all webview ^
  --collect-all clr_loader ^
  --collect-all vosk ^
  --collect-all sounddevice ^
  app.py
echo.
echo Готово. Приложение: dist\FaceComposite\FaceComposite.exe
pause
