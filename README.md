# Mesa Clara POS

Punto de venta básico, rápido y responsive para restaurantes o tiendas. Construido con Astro y JavaScript sin framework de UI.

## Incluye

- Tiendas ilimitadas con catálogo independiente.
- Productos ilimitados, categorías, búsqueda, edición y estado activo/oculto.
- Login por usuario/clave con roles Admin y Cajero.
- Admin crea, edita y bloquea acceso de cajera central.
- Acceso administrador para tiendas, productos, cajeros, ajustes, eventos y cuadre.
- Eventos con consolidado global y detalle por tienda.
- Apertura y cierre de caja con arqueo por efectivo, Yape y tarjeta.
- Carrito, cliente/mesa, vuelto e historial de ventas.
- Dos tickets térmicos de 80 mm: `TICKET CLIENTE` y `TICKET · NOMBRE DE TIENDA`.
- Reimpresión, impresión conjunta y reportes Excel `.xlsx` con resumen y detalle.
- Base SQLite compartida en la computadora principal, caché local de respaldo y diseño responsive.

## Ejecutar compartido en red

```bash
npm install
npm run shared
```

En computadora principal abrir `http://127.0.0.1:4321`. En otras computadoras de misma red abrir URL `Red:` mostrada al iniciar, por ejemplo `http://10.195.59.86:4321`.

Todas usan misma base `data/pos.sqlite`. Cambios se sincronizan aproximadamente cada 1.2 segundos. Computadora principal debe permanecer encendida y servidor ejecutándose.

`npm run dev` queda disponible para desarrollo visual, pero no levanta API SQLite compartida.

Credenciales demo:

- Admin: usuario `admin`, clave `admin123`.
- Cajero: usuario `flor`, clave `julio`.

## Flujo de evento

1. Admin crea locales, productos por local y acceso de cajera central.
2. Admin inicia evento.
3. Cajera inicia sesión y abre una sola caja central para todo el festival.
4. Cajera puede cerrar sesión sin cerrar caja; caja permanece abierta y protegida por login.
5. Cajera elige local, registra compra y genera ticket de ese local.
6. Si cliente compra en otro local, cajera cambia local e inicia nueva venta/ticket. Carrito nunca mezcla locales.
7. Cajera o Admin puede cerrar caja registrando efectivo contado.
8. Admin cierra evento. Sistema bloquea cierre si caja central sigue abierta.
9. Cuadre final muestra ventas por local y arqueo global de caja central.
10. Cuadre puede imprimirse o exportarse como Excel estructurado.

## Validar

```bash
npm test
npm run build
```

Salida lista para publicar: `dist/`.

## Publicar

Frontend Astro es compatible con Vercel:

- Comando de build: `npm run build`
- Carpeta de salida: `dist`
- Versión Node recomendada: 22 LTS o superior

Para nube multi-PC permanente, sustituir API SQLite local por Supabase/Postgres. Vercel no conserva archivo SQLite local entre ejecuciones. No subir `data/pos.sqlite`: está excluido por `.gitignore`.

## Seguridad del prototipo

Servidor local está pensado para red confiable del evento. Claves demo aún se guardan dentro del estado; antes de publicar usar Supabase Auth, roles seguros, HTTPS, copias de seguridad y políticas RLS. Navegador conserva caché local solo como respaldo temporal; SQLite es fuente común mientras servidor está disponible.
