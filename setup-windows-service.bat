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
nvm list | find "22.20.0" >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Node.js v22.20.0 no encontrado. Instalando...
    nvm install 22.20.0
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Fallo la instalacion de Node.js v22.20.0
        pause
        exit /b 1
    )
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
node --version
npm --version

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
echo [8/12] Preparando archivos de produccion...
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

REM Copiar Prisma
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

echo.
echo [9/12] Instalando dependencias de produccion para API...
cd /d "%ROOT_DIR%service-api"
call npm install --production --silent

cd /d "%ROOT_DIR%"

echo.
echo [10/12] Creando scripts de inicio...

REM Crear start-all.bat
echo @echo off > start-all.bat
echo title Procavar Pedidos - Servicios >> start-all.bat
echo color 0B >> start-all.bat
echo. >> start-all.bat
echo echo ======================================== >> start-all.bat
echo echo INICIANDO SERVICIOS PROCAVAR PEDIDOS >> start-all.bat
echo echo ======================================== >> start-all.bat
echo echo. >> start-all.bat
echo. >> start-all.bat
echo echo [1/2] Iniciando API en puerto 8400... >> start-all.bat
echo start "Procavar API" /MIN cmd /c "cd /d "%~dp0service-api" ^&^& node dist/index.js" >> start-all.bat
echo timeout /t 3 /nobreak ^>nul >> start-all.bat
echo. >> start-all.bat
echo echo [2/2] Iniciando Frontend en puerto 5000... >> start-all.bat
echo start "Procavar Frontend" /MIN cmd /c "cd /d "%~dp0service-front" ^&^& serve -s dist -l 5000" >> start-all.bat
echo. >> start-all.bat
echo echo ======================================== >> start-all.bat
echo echo SERVICIOS INICIADOS >> start-all.bat
echo echo ======================================== >> start-all.bat
echo echo API:      http://localhost:8400 >> start-all.bat
echo echo Frontend: http://localhost:5000 >> start-all.bat
echo echo ======================================== >> start-all.bat
echo pause >> start-all.bat

echo Script start-all.bat creado.

echo.
echo [11/12] Limpiando codigo fuente? (OPCIONAL)
echo ----------------------------------------
echo ADVERTENCIA: Esto eliminara los archivos TypeScript (.ts, .tsx)
echo Solo mantendra el codigo compilado en service-api y service-front
echo.
set /p CLEAN_SOURCE="Desea eliminar el codigo fuente? (SI/NO): "

if /i "%CLEAN_SOURCE%"=="SI" (
    echo.
    echo Eliminando codigo fuente de API...
    if exist "%ROOT_DIR%api\src" rmdir /s /q "%ROOT_DIR%api\src"
    if exist "%ROOT_DIR%api\tsconfig.json" del /q "%ROOT_DIR%api\tsconfig.json"
    
    echo Eliminando codigo fuente de Frontend...
    if exist "%ROOT_DIR%front\src" rmdir /s /q "%ROOT_DIR%front\src"
    if exist "%ROOT_DIR%front\tsconfig.json" del /q "%ROOT_DIR%front\tsconfig.json"
    if exist "%ROOT_DIR%front\tsconfig.node.json" del /q "%ROOT_DIR%front\tsconfig.node.json"
    
    echo Codigo fuente eliminado. Solo queda el codigo compilado.
) else (
    echo Codigo fuente preservado.
)

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
echo.
echo Node.js version: v22.20.0
echo.
echo Archivos generados:
echo   - service-api\      (API compilada)
echo   - service-front\    (Frontend compilado)
echo   - start-all.bat     (Iniciar servicios manualmente)
echo.
echo URLs de acceso:
echo   API:      http://localhost:8400
echo   Frontend: http://localhost:5000
echo.
echo Comandos utiles:
echo   start-all.bat       - Iniciar servicios (sin PM2)
echo   pm2 status          - Ver estado de las apps (con PM2)
echo   pm2 logs            - Ver logs en tiempo real (con PM2)
echo   pm2 restart all     - Reiniciar aplicaciones (con PM2)
echo   pm2 stop all        - Detener aplicaciones (con PM2)
echo ========================================
pause
