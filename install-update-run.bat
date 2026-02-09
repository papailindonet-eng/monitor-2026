@echo off
setlocal
cd /d %~dp0

echo Atualizando dependencias e limpando instalacao antiga...
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del /f /q package-lock.json

echo Limpando cache do npm...
call npm cache clean --force

echo Instalando dependencias...
call npm install
if errorlevel 1 (
  echo.
  echo Falha ao instalar dependencias. Verifique a saida acima.
  pause
  exit /b 1
)

echo Iniciando servidor...
call npm start
pause
