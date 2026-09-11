Diseño limpio, bordes redondeados, tipografía sans-serif moderna (parece Inter o similar).

Header (barra superior)
Breadcrumb en la esquina superior izquierda: "Unleash Factory" (texto gris medio, ~font-weight 500) seguido de un ícono chevron ">" (gris claro) y luego "Agents" (texto negro/gris oscuro, bold).
Padding horizontal generoso (~24px), altura aproximada de 64px.
Borde inferior sutil de 1px color gris muy claro (
#EAEAEA aprox) separando el header del contenido.

Lado derecho del header, en fila horizontal con espaciado de ~8px entre elementos:

Botón cuadrado con ícono de lupa (search), borde gris claro, fondo blanco, esquinas redondeadas (~8px), tamaño ~40x40px.
Botón cuadrado igual al anterior pero con ícono de filtro (líneas horizontales tipo "sliders").
Botón "New" con fondo negro sólido, texto blanco, esquinas redondeadas (~8px), con un ícono de flecha chevron hacia abajo a la derecha del texto. Padding horizontal ~16px, vertical ~10px.
Área de contenido principal

Fondo gris muy claro (
#FAFAFA o 
#F7F7F8), con padding alrededor (~24px).

Tarjeta principal (nivel superior - "Foreman")
Card blanca con borde sutil gris claro y esquinas redondeadas (~12px).
Ancho completo del contenedor.
Padding interno ~20px.
Layout horizontal: ícono a la izquierda + bloque de texto a la derecha.
Ícono: cuadrado con esquinas redondeadas (~10px), fondo lila/púrpura claro (
#F2E9FE aprox), ícono de organigrama/jerarquía en color púrpura (
#8B5CF6 o similar).
Título: "Unleash Factory Foreman Agent" — negro, bold, ~16px.
Subtítulo: "Orchestrates the factory workflow and dispatches each gated step." — gris medio, ~14px, peso normal, debajo del título.
Margen inferior de ~16px antes del bloque de sub-agentes.
Bloque de sub-agentes (indentado, conectado con línea)
Todo el bloque está desplazado a la derecha (~40-48px de indentación respecto a la tarjeta principal) para indicar jerarquía.
Línea conectora vertical en gris claro, punteada/discontinua, que corre desde abajo de la tarjeta Foreman hacia abajo, con pequeñas ramas horizontales curvas conectando a cada tarjeta hija (estilo "árbol" de organigrama, línea tipo border-left con curvas tipo border-radius en las conexiones).
Espaciado vertical entre tarjetas: ~12-16px.

Cada tarjeta hija tiene el mismo estilo: fondo blanco, borde gris claro sutil, esquinas redondeadas (~10px), padding interno ~16-20px, layout horizontal (ícono + texto).

1. Triage Agent

Ícono: cuadrado gris claro con un círculo punteado/dashed animado tipo "loading spinner" en gris oscuro (sugiere estado "en progreso" o "pendiente").
Título: "Unleash Factory Triage Agent" (bold, negro)
Subtítulo: "Triages requests and establishes task state." (gris, normal)

2. Spec Agent

Ícono: cuadrado con fondo naranja/durazno claro (
#FEEBD6 aprox), ícono de documento/etiqueta con signo "$" o similar en color naranja (
#F97316 aprox) — parece un ícono de "spec/tag" con detalle circular.
Título: "Unleash Factory Spec Agent"
Subtítulo: "Writes and drives approval of specifications."

3. Implement Agent

Ícono: cuadrado con fondo azul claro (
#DCEAFE aprox), ícono de code "</>" en azul (
#3B82F6 aprox).
Título: "Unleash Factory Implement Agent"
Subtítulo: "Implements, validates, and updates code changes."

4. Review Agent

Ícono: cuadrado con fondo rosa/magenta claro (
#FCE4F1 aprox), ícono de dos globos de chat/mensaje en color rosa fuerte/magenta (
#EC4899 aprox).
Título: "Unleash Factory Review Agent"
Subtítulo: "Reviews factory pull requests and routes findings to rework or human resolution."
Tarjeta final "New agent"
Misma indentación y ancho que las tarjetas de sub-agentes.
Borde punteado (dashed), fondo transparente/blanco, esquinas redondeadas.
Contenido centrado (texto y contenido alineados al centro, no a la izquierda como las demás).
Ícono "+" seguido del texto "New agent", color gris medio, sin ícono de color de fondo (a diferencia de las otras tarjetas).
Actúa visualmente como botón de acción para agregar un nuevo agente.
Paleta de colores resumen
Elemento	Color aprox
Fondo general	
#FFFFFF / 
#FAFAFA
Bordes de tarjetas	
#E5E5E5
Texto títulos	
#111111
Texto subtítulos	
#6B7280
Botón "New"	fondo 
#000000, texto 
#FFFFFF
Ícono Foreman (fondo/ícono)	
#F2E9FE / 
#8B5CF6
Ícono Triage (fondo/ícono)	
#F3F4F6 / 
#4B5563
Ícono Spec (fondo/ícono)	
#FEEBD6 / 
#F97316
Ícono Implement (fondo/ícono)	
#DCEAFE / 
#3B82F6
Ícono Review (fondo/ícono)	
#FCE4F1 / 
#EC4899
Línea conectora	
#D1D5DB, estilo dashed
Notas de layout técnico
Contenedor tipo lista vertical (flex-direction: column, gap: 12-16px).
Cada tarjeta usa display: flex; align-items: center; gap: 16px.
Los íconos son contenedores de ~40x40px con border-radius: 10px y el ícono SVG centrado dentro (~20x20px).
La jerarquía visual (Foreman → hijos) se logra con un contenedor padre que tiene un padding-left o margin-left y un pseudo-elemento o SVG de línea conectora tipo árbol de organigrama (similar a un diagrama de flujo/tree view).
Todo el conjunto está dentro de un contenedor con max-width centrado en la página, con márgenes generosos.