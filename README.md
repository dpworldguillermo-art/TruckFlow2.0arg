# TruckFlow 2.0 · Gambetta 2

Aplicación web para visualizar el tránsito de camiones y contenedores de Gambetta 2.

## Arquitectura
- Cloudflare Worker: API + servidor web.
- Workers Static Assets: frontend público.
- Workers KV (se configura en el paso 2): último dataset publicado.
- Agente local Python: vigila `C:\Proyectos\TruckFlow2.0\entradas` y publica el Excel más reciente.

## Primera publicación
La primera versión puede desplegarse sin KV. Mostrará el dataset de demostración incluido en `public/data/latest.json`.

## Conectar datos automáticos
Después del primer despliegue:
1. Crear un KV namespace.
2. Añadir binding `DATA` en `wrangler.jsonc`.
3. Crear secreto `SYNC_TOKEN`.
4. Configurar `sync/config.json` con la ruta local y la URL del Worker.
5. Ejecutar `python sync/sync_agent.py sync/config.json`.

## Seguridad
Mantener el repositorio GitHub como **Private**. Antes de conectar datos operativos reales, se recomienda proteger la web con Cloudflare Access si no debe ser pública.
