# Procavar Pedidos - Guía de Despliegue en Windows

## 🚀 Instalación Automática (Recomendado)

### Instalación completa en un solo paso

**Ejecuta como Administrador** (clic derecho → "Ejecutar como administrador"):

```bash
setup-windows-service.bat
```

Este script hace **TODO** automáticamente:
1. ✅ Verifica e instala NVM y Node.js v22.20.0
2. ✅ Instala herramientas globales (PM2, serve)
3. ✅ Compila la API con Prisma (migraciones y seed)
4. ✅ Compila el Frontend
5. ✅ Crea carpetas de producción (service-api, service-front)
6. ✅ Copia archivos compilados
7. ✅ Instala dependencias de producción
8. ✅ Crea script `start-all.bat` para inicio manual
9. ✅ Pregunta si deseas eliminar el código fuente (protección)
10. ✅ Configura PM2 para iniciar con Windows
11. ✅ Inicia los servicios automáticamente

**URLs después de la instalación:**
- **API**: http://localhost:8400
- **Frontend**: http://localhost:5000

**Usuario por defecto:**
- Username: `admin`
- Password: `123456`

---

## Inicio Manual del Sistema

Si no usas PM2, puedes iniciar los servicios manualmente:

```bash
start-all.bat
```

Este script inicia ambos servicios en ventanas separadas minimizadas.

---

## Gestión con PM2

### Comandos útiles de PM2

```bash
# Ver estado de las aplicaciones
pm2 status

# Ver logs en tiempo real
pm2 logs

# Ver logs de una app específica
pm2 logs procavar-api
pm2 logs procavar-frontend

# Reiniciar aplicaciones
pm2 restart all
pm2 restart procavar-api
pm2 restart procavar-frontend

# Detener aplicaciones
pm2 stop all
pm2 stop procavar-api

# Iniciar aplicaciones
pm2 start ecosystem.config.js

# Eliminar aplicaciones de PM2
pm2 delete all

# Guardar configuración (importante después de cambios)
pm2 save
```

---

## Opción 3: Servidor Web con IIS

### Frontend con IIS

1. Compilar el frontend con `setup-windows-service.bat` o manualmente:

   ```bash
   cd front
   npm install
   npm run build
   ```

2. Configurar IIS:
   - Crear nuevo sitio web en IIS
   - Apuntar la ruta física a `service-front\dist`
   - Configurar puerto (ej: 80 o 5000)

3. Crear `web.config` en `service-front\dist`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <configuration>
     <system.webServer>
       <rewrite>
         <rules>
           <rule name="React Routes" stopProcessing="true">
             <match url=".*" />
             <conditions logicalGrouping="MatchAll">
               <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
               <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
             </conditions>
             <action type="Rewrite" url="/" />
           </rule>
         </rules>
       </rewrite>
     </system.webServer>
   </configuration>
   ```

### API con IIS (usando iisnode)

Requiere configuración adicional con iisnode o mejor usar PM2.

---

## Configuración de Variables de Entorno

### API (.env)

Crear/editar `api\.env`:

```env
PORT=8400
DATABASE_URL="file:./prisma/dev.db"
JWT_SECRET=tu_secreto_seguro_aqui
CORS_ORIGIN=*
NODE_ENV=production
```

### Frontend

Las variables ya están configuradas en `front\src\config\index.ts` con valor por defecto `http://localhost:8400`

---

## Actualización del Sistema

### Con PM2

```bash
# Detener servicios
pm2 stop all

# Actualizar código (git pull, etc.)
git pull

# Reinstalar dependencias si es necesario
cd api && npm install && npm run build && cd ..
cd front && npm install && npm run build && cd ..

# Copiar archivos compilados a service-*
xcopy /E /I /Y front\dist service-front\dist
xcopy /E /I /Y api\dist service-api\dist

# Reiniciar servicios
pm2 restart all
```

### Sin PM2

Simplemente cerrar las ventanas y volver a ejecutar `start-all.bat`

---

## Troubleshooting

### Puerto en uso

Si el puerto 8400 u otro está ocupado:

- Cambiar en `api\.env` el PORT
- Actualizar `API_BASE_URL` en `front\src\config\index.ts`
- Recompilar frontend con `npm run build`

### PM2 no inicia con Windows

```bash
pm2 startup
pm2 save
```

### Ver logs de errores

```bash
# Con PM2
pm2 logs --err

# Sin PM2
Revisar las ventanas de cmd donde corren los servicios
```

---

## Respaldos

### Base de datos

La base de datos SQLite está en `service-api\prisma\dev.db`
Copiar este archivo regularmente para respaldos.

### Logs (con PM2)

Los logs se guardan en `logs\` (configurado en ecosystem.config.js)
