@echo off
echo ========================================
echo PROCAVAR PEDIDOS - SETUP DE PRODUCCION
echo ========================================
echo.

REM Verificar si NVM esta instalado
echo [1/7] Verificando NVM (Node Version Manager)...
where nvm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: NVM no esta instalado
    echo.
    echo Por favor instala NVM para Windows desde:
    echo https://github.com/coreybutler/nvm-windows/releases
    echo.
    echo 1. Descarga nvm-setup.exe
    echo 2. Ejecuta el instalador
    echo 3. Reinicia este script
    echo.
    pause
    exit /b 1
)

echo NVM encontrado: OK
echo.

REM Verificar si Node.js v22.20.0 esta instalado
echo [2/7] Verificando Node.js v22.20.0...
nvm list | find "22.20.0" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Node.js v22.20.0 no encontrado. Instalando...
    call nvm install 22.20.0
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Fallo la instalacion de Node.js v22.20.0
        pause
        exit /b 1
    )
) else (
    echo Node.js v22.20.0 ya esta instalado: OK
)

echo.
echo [3/7] Activando Node.js v22.20.0...
call nvm use 22.20.0
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: No se pudo activar Node.js v22.20.0
    pause
    exit /b 1
)

echo.
node --version
npm --version

echo.
echo [4/7] Instalando herramientas globales...
call npm install -g pm2
call npm install -g pm2-windows-startup
call npm install -g serve

echo.
echo [5/7] Configurando PM2 para iniciar con Windows...
call pm2-startup install

echo.
echo [6/7] Compilando API (Backend)...
cd api
call npm install
call npx prisma generate
call npx prisma migrate deploy
call npx prisma db seed
call npm run build
cd ..

echo.
echo [7/7] Compilando Frontend...
cd front
call npm install
call npm run build
cd ..

echo.
echo Iniciando aplicaciones con PM2...
call pm2 start ecosystem.config.js

echo.
echo Guardando configuracion de PM2...
call pm2 save

echo.
echo ========================================
echo INSTALACION COMPLETADA!
echo ========================================
echo.
echo Node.js version: v22.20.0
echo URLs de acceso:
echo   API:      http://localhost:8400
echo   Frontend: http://localhost:5000
echo.
echo Comandos utiles:
echo   pm2 status      - Ver estado de las apps
echo   pm2 logs        - Ver logs en tiempo real
echo   pm2 restart all - Reiniciar aplicaciones
echo   pm2 stop all    - Detener aplicaciones
echo ========================================
pause
