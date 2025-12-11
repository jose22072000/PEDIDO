@echo off
title Limpiar Codigo Fuente - Procavar Pedidos
color 0C

echo ========================================
echo  ADVERTENCIA: LIMPIAR CODIGO FUENTE
echo ========================================
echo.
echo Este script eliminara todo el codigo fuente TypeScript
echo y dejara solo los archivos compilados para produccion.
echo.
echo Archivos que se eliminaran:
echo   - api\src\              (Codigo fuente API)
echo   - api\tsconfig.json     (Configuracion TypeScript)
echo   - front\src\            (Codigo fuente Frontend)
echo   - front\tsconfig.json   (Configuracion TypeScript)
echo   - Otros archivos de desarrollo
echo.
echo Archivos que se mantendran:
echo   - service-api\          (API compilado)
echo   - service-front\        (Frontend compilado)
echo.

REM Verificar que existan las carpetas de servicio
if not exist "service-api" (
    echo ERROR: No se encontro la carpeta 'service-api'
    echo Por favor ejecuta 'build-all.bat' primero
    pause
    exit /b 1
)

if not exist "service-front" (
    echo ERROR: No se encontro la carpeta 'service-front'
    echo Por favor ejecuta 'build-all.bat' primero
    pause
    exit /b 1
)

echo.
echo Esta accion NO se puede deshacer.
echo.
set /p CONFIRM="Estas seguro? (escribe SI para continuar): "

if /i NOT "%CONFIRM%"=="SI" (
    echo.
    echo Operacion cancelada.
    pause
    exit /b 0
)

echo.
echo Eliminando codigo fuente...
echo.

REM Eliminar codigo fuente de API
if exist "api\src" (
    echo Eliminando api\src\...
    rmdir /s /q "api\src"
)
if exist "api\tsconfig.json" (
    echo Eliminando api\tsconfig.json
    del /q "api\tsconfig.json"
)
if exist "api\tsconfig.build.json" (
    del /q "api\tsconfig.build.json"
)

REM Eliminar codigo fuente de Frontend
if exist "front\src" (
    echo Eliminando front\src\...
    rmdir /s /q "front\src"
)
if exist "front\tsconfig.json" (
    echo Eliminando front\tsconfig.json
    del /q "front\tsconfig.json"
)
if exist "front\tsconfig.node.json" (
    del /q "front\tsconfig.node.json"
)
if exist "front\vite.config.ts" (
    del /q "front\vite.config.ts"
)
if exist "front\postcss.config.js" (
    del /q "front\postcss.config.js"
)
if exist "front\tailwind.config.js" (
    del /q "front\tailwind.config.js"
)

REM Eliminar archivos de desarrollo
if exist "front\index.html" (
    del /q "front\index.html"
)
if exist "front\eslint.config.mjs" (
    del /q "front\eslint.config.mjs"
)

REM Eliminar node_modules (opcional, puedes comentar si quieres mantenerlos)
echo.
set /p DELETE_MODULES="Eliminar node_modules tambien? (escribe SI para eliminar): "

if /i "%DELETE_MODULES%"=="SI" (
    if exist "api\node_modules" (
        echo Eliminando api\node_modules\...
        rmdir /s /q "api\node_modules"
    )
    if exist "front\node_modules" (
        echo Eliminando front\node_modules\...
        rmdir /s /q "front\node_modules"
    )
)

echo.
echo ========================================
echo LIMPIEZA COMPLETADA!
echo ========================================
echo.
echo El codigo fuente ha sido eliminado.
echo.
echo Carpetas de produccion:
echo   - service-api\      (API compilado - ejecutable)
echo   - service-front\    (Frontend compilado - estatico)
echo.
echo Para usar el sistema ahora, actualiza los scripts
echo para que apunten a las carpetas service-*
echo ========================================
pause
