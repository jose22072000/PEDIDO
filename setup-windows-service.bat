@echo off
title Procavar Pedidos - Instalacion Completa
color 0B

set "ROOT_DIR=%~dp0"

echo ========================================
echo PROCAVAR PEDIDOS - INSTALACION COMPLETA
echo ========================================
echo.
echo Este script hara lo siguiente:
echo  1. Verificar e instalar NVM y Node.js v22.20.0
echo  2. Instalar herramientas globales (PM2, serve)
echo  3. Compilar API y Frontend
echo  4. Preparar archivos de produccion
echo  5. Configurar PM2 para iniciar con Windows
echo  6. Iniciar los servicios
echo.
pause
echo.

echo.
echo [1/12] Verificando NVM (Node Version Manager)...
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

echo.
echo [2/12] Verificando Node.js v22.20.0...
call nvm list | find "22.20.0" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Node.js v22.20.0 no encontrado. Instalando...
    call nvm install 22.20.0
) else (
    echo Node.js v22.20.0 ya esta instalado: OK
)

echo.
echo [3/12] Activando Node.js v22.20.0...
call nvm use 22.20.0

REM Esperar a que NVM configure el entorno
timeout /t 2 /nobreak >nul

echo.
echo Verificando Node.js...
call node --version 2>nul
call npm --version 2>nul

echo.
echo [4/12] Instalando herramientas globales...
echo Instalando PM2...
call npm install -g pm2

echo Instalando pm2-windows-startup...
call npm install -g pm2-windows-startup

echo Instalando serve...
call npm install -g serve

echo.
echo [5/12] Configurando PM2 para iniciar con Windows...
call pm2-startup install

echo.
echo [6/12] Compilando API (Backend)...
cd /d "%~dp0api"
call npm install
call npx -y prisma generate
call npx -y prisma migrate deploy
call npx -y prisma db seed
call npm run build

cd /d "%~dp0"

echo.
echo [7/12] Compilando Frontend...
cd /d "%~dp0front"
call npm install
call npm run build

cd /d "%ROOT_DIR%"

echo.
echo ========================================
echo COMPILACION EXITOSA!
echo ========================================

echo.
echo [12/12] Configurando e iniciando servicios con PM2...
echo ----------------------------------------

REM Detener servicios previos si existen
call pm2 delete all 2>nul

REM Iniciar con PM2
call pm2 start ecosystem.config.js

REM Guardar configuracion PM2
call pm2 save

echo.
echo Servicios iniciados con PM2 correctamente.

:FINISH
echo.
echo ========================================
echo INSTALACION COMPLETADA!
echo ========================================
pause
