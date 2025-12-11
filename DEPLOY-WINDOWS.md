# Procavar Pedidos - Guía de Despliegue en Windows

## 🚀 Instalación Rápida (Recomendado)

### Paso 1: Compilar el sistema

Ejecutar `build-all.bat` - Compila tanto API como Frontend a JavaScript puro.

```bash
build-all.bat
```

Esto genera:

- `api\dist\` - Backend compilado (protegido)
- `front\dist\` - Frontend compilado (protegido)

### Paso 2: Elegir método de ejecución

**Opción A: Scripts simples**

```bash
start-all.bat
```

**Opción B: Servicio de Windows con PM2** (recomendado)

```bash
# Ejecutar como Administrador
setup-windows-service.bat
```

---

## Opción 1: Ejecución con Scripts BAT (Producción)

### Compilación inicial

1. **Compilar todo el sistema:**

   ```bash
   build-all.bat
   ```

2. **O compilar individualmente:**

   ```bash
   # API
   cd api
   build-api.bat
   
   # Frontend
   cd front
   build-frontend.bat
   ```

### Inicio del sistema

Ejecutar `start-all.bat` - Inicia API y Frontend compilados

- **API**: <http://localhost:8400> (código compilado en `api\dist`)
- **Frontend**: <http://localhost:5000> (código compilado en `front\dist`)

### Scripts individuales

#### API (Backend compilado)

```bash
cd api
start-api.bat
```

#### Frontend (Build compilado)

```bash
cd front
start-frontend.bat
```

---

## Opción 2: Servicio de Windows con PM2 (Recomendado para Producción)

### Instalación inicial (ejecutar como Administrador)

1. Ejecutar `setup-windows-service.bat` como Administrador
   - Instala PM2 y dependencias
   - Configura inicio automático con Windows
   - Compila el frontend
   - Inicia los servicios

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
```

### URLs de acceso
- **API**: http://localhost:8400
- **Frontend**: http://localhost:5000

---

## Opción 3: Servidor Web (IIS)

### Frontend con IIS

1. Compilar el frontend:
   ```bash
   cd front
   npm run build
   ```

2. Configurar IIS:
   - Crear nuevo sitio web en IIS
   - Apuntar la ruta física a `front\dist`
   - Configurar puerto (ej: 80 o 5000)

3. Crear `web.config` en `front\dist`:
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
DATABASE_URL="file:./dev.db"
JWT_SECRET=tu_secreto_seguro_aqui
CORS_ORIGIN=http://localhost:5000,http://localhost:5173
NODE_ENV=production
```

### Frontend
Las variables ya están configuradas en `front\src\config\index.ts`

---

## Actualización del Sistema

### Con PM2
```bash
# Detener servicios
pm2 stop all

# Actualizar código (git pull, etc.)
git pull

# Reinstalar dependencias si es necesario
cd api && npm install && cd ..
cd front && npm install && npm run build && cd ..

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
La base de datos SQLite está en `api\prisma\dev.db`
Copiar este archivo regularmente para respaldos.

### Logs (con PM2)
Los logs se guardan en `logs\` (configurado en ecosystem.config.js)
