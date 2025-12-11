@echo off
title Compilar Sistema Completo - Procavar Pedidos
color 0B

echo ========================================
echo COMPILANDO SISTEMA COMPLETO
echo ========================================
echo.

set "ROOT_DIR=%~dp0"

REM Verificar NVM y Node.js
where nvm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: NVM no esta instalado
    echo Por favor ejecuta setup-windows-service.bat primero
    pause
    exit /b 1
)

nvm list | find "22.20.0" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js v22.20.0 no esta instalado
    echo Por favor ejecuta setup-windows-service.bat primero
    pause
    exit /b 1
)

call nvm use 22.20.0
echo Usando Node.js v22.20.0
echo.

echo [1/2] Compilando API (Backend)...
echo ----------------------------------------
cd /d "%ROOT_DIR%api"
call npm install
call npx prisma generate
call npx prisma migrate deploy
call npx prisma db seed
call npm run build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Fallo la compilacion de la API
    pause
    exit /b 1
)

echo.
echo [2/2] Compilando Frontend...
echo ----------------------------------------
cd /d "%ROOT_DIR%front"
call npm install
call npm run build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Fallo la compilacion del Frontend
    pause
    exit /b 1
)

cd /d "%ROOT_DIR%"

echo.
echo ========================================
echo COMPILACION EXITOSA!
echo ========================================
echo.
echo [3/3] Preparando archivos de produccion...
echo ----------------------------------------

REM Crear carpetas de servicio
if not exist "service-api" mkdir service-api
if not exist "service-front" mkdir service-front

REM Copiar API compilado
echo Copiando API compilado a service-api...
xcopy /E /I /Y "%ROOT_DIR%api\dist" "%ROOT_DIR%service-api\dist" >nul
xcopy /Y "%ROOT_DIR%api\package.json" "%ROOT_DIR%service-api\" >nul
xcopy /Y "%ROOT_DIR%api\package-lock.json" "%ROOT_DIR%service-api\" >nul 2>nul
if exist "%ROOT_DIR%api\.env" xcopy /Y "%ROOT_DIR%api\.env" "%ROOT_DIR%service-api\" >nul

REM Copiar Prisma (necesario para migraciones y schema)
xcopy /E /I /Y "%ROOT_DIR%api\prisma" "%ROOT_DIR%service-api\prisma" >nul
xcopy /E /I /Y "%ROOT_DIR%api\node_modules\.prisma" "%ROOT_DIR%service-api\node_modules\.prisma" >nul 2>nul
xcopy /E /I /Y "%ROOT_DIR%api\node_modules\@prisma" "%ROOT_DIR%service-api\node_modules\@prisma" >nul 2>nul

REM Copiar base de datos SQLite
if exist "%ROOT_DIR%api\prisma\dev.db" (
    echo Copiando base de datos...
    xcopy /Y "%ROOT_DIR%api\prisma\dev.db" "%ROOT_DIR%service-api\prisma\" >nul
    if exist "%ROOT_DIR%api\prisma\dev.db-journal" xcopy /Y "%ROOT_DIR%api\prisma\dev.db-journal" "%ROOT_DIR%service-api\prisma\" >nul 2>nul
)

REM Copiar uploads si existe
if exist "%ROOT_DIR%api\uploads" xcopy /E /I /Y "%ROOT_DIR%api\uploads" "%ROOT_DIR%service-api\uploads" >nul

REM Copiar Frontend compilado
echo Copiando Frontend compilado a service-front...
xcopy /E /I /Y "%ROOT_DIR%front\dist" "%ROOT_DIR%service-front\dist" >nul

REM Instalar serve globalmente si no existe
echo.
echo Verificando serve...
where serve >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Instalando serve globalmente...
    call npm install -g serve
) else (
    echo serve ya esta instalado
)

REM Instalar solo dependencias de produccion para API
echo.
echo Instalando dependencias de produccion para API...
cd /d "%ROOT_DIR%service-api"
call npm install --production
cd /d "%ROOT_DIR%"

echo.
echo ========================================
echo PREPARACION COMPLETADA!
echo ========================================
echo.
echo Archivos generados:
echo   - service-api\      (API lista para produccion)
echo   - service-front\    (Frontend listo para produccion)
echo.
echo Para limpiar codigo fuente:
echo   clean-source.bat
echo.
echo Para iniciar el sistema:
echo   1. Con scripts BAT: start-all.bat
echo   2. Con PM2: pm2 start ecosystem.config.js
echo ========================================
pause
