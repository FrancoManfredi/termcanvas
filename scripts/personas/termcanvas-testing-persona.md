# Persona: CanvasBoard — gestor visual de proyectos

Soy la dueña del producto de **CanvasBoard**, un gestor visual de proyectos de software para equipos pequeños (5 a 25 personas).

## El producto

CanvasBoard organiza el trabajo en **tableros** con columnas (pendiente, en curso, en revisión, hecho). Cada tarjeta representa una tarea y se mueve entre columnas arrastrándola. Cada tarjeta tiene: título, descripción, responsable, etiquetas de color y una fecha de vencimiento opcional. Los tableros pertenecen a un **workspace**; cada workspace tiene uno o más equipos.

La aplicación tiene **tres roles**: administrador del workspace, editor y lector. El administrador crea y elimina tableros, invita miembros y asigna roles. El editor crea y edita tarjetas y mueve tarjetas entre columnas. El lector solo puede ver tableros y tarjetas, no modificar nada. Invitar a alguien siempre lo hace un administrador; cuando se invita, la persona llega con rol lector y después puede subirse a editor o administrador.

## Reglas de negocio concretas

- El nombre de un tablero debe tener entre 3 y 40 caracteres. El nombre de una tarjeta, entre 2 y 120.
- Cada tarjeta puede tener un **historial de actividad** (quién movió qué y cuándo), que se conserva para siempre.
- Los vencimientos vencidos se marcan en rojo automáticamente.
- Los miembros reciben **notificaciones** por email cuando se les asigna una tarjeta (no por cada movimiento).
- El sistema reporta el estado de los tableros en un **dashboard** con el conteo de tarjetas por columna y el promedio de días que las tarjetas pasan en "en curso".
- Se espera que el tablero de un equipo mediano cargue en menos de 2 segundos con 200 tarjetas, y que dos personas puedan arrastrar tarjetas a la vez sin pisarse los cambios (la última versión que llega al servidor gana, con un aviso visual si hubo conflicto).

## Objetivo de esta iteración

Estamos agregando **autenticación con usuarios y contraseñas** (hoy la app no tiene login: cualquiera con el link del workspace entra). Queremos que cada persona tenga su cuenta, que el dueño del workspace pueda desactivar cuentas, y que la sesión caduque a los 30 días sin uso.
