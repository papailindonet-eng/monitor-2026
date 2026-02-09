@echo off
setlocal
cd /d %~dp0

echo Limpando dependencias antigas...
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del /f /q package-lock.json

echo Limpando cache do npm...
call npm cache clean --force

echo Instalando dependencias...
call npm install

echo.
echo Concluido. Para iniciar o app: npm start
pause
