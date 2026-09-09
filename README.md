# Music Visualizer — Three.js + estilo Windows Media Player

Proyecto de aprendizaje: un reproductor de música con visualizador 3D hecho con
[Three.js](https://threejs.org/) y la Web Audio API, con una interfaz que
imita el look clásico de Windows Media Player.

## Qué usa

- **Three.js** (vía CDN, importado como módulo ES + addons `examples/jsm`)
  para el visualizador 3D, con post-procesado (`EffectComposer` +
  `UnrealBloomPass`) para el brillo neón y `OrbitControls` para poder
  girar/acercar la cámara con mouse o touch.
- **Web Audio API** (`AnalyserNode`) para analizar las frecuencias del audio
  en tiempo real.
- HTML/CSS/JS puro, sin frameworks ni build tools.

## Interactuar con la visualización

El canvas responde a mouse y touch (vía `OrbitControls`):

- **Arrastrar** (mouse o un dedo) → orbita la cámara alrededor de la escena.
- **Rueda del mouse / pellizcar con dos dedos** → zoom in/out.
- Si soltás y no tocás nada por 4 segundos, la cámara retoma sola una rotación
  lenta (`autoRotate`) para que la escena no quede estática.

## Modos de visualización

Seleccionables desde la pestaña **"Visualizaciones"** del panel lateral
(al lado de la lista de reproducción):

1. **Espectro circular** — barras 3D dispuestas en círculo + esfera central,
   con bloom para el brillo neón.
2. **Terreno de ondas** — inspirado en
   [`webgl_geometry_terrain_raycast`](https://threejs.org/examples/webgl_geometry_terrain_raycast.html):
   una malla de terreno que se desplaza hacia la cámara, con la altura de
   cada fila generada en vivo a partir del espectro de frecuencias.
3. **Anáglifo 3D (rojo/cian)** — mismo contenido del espectro circular,
   pero renderizado con
   [`AnaglyphEffect`](https://threejs.org/examples/webgl_effects_anaglyph.html)
   (estereoscopía roja/cian real — usá lentes 3D para ver la profundidad).
4. **Radar de helpers** — inspirado en
   [`webgl_helpers`](https://threejs.org/examples/webgl_helpers.html):
   combina `ArrowHelper`, `PolarGridHelper`, `AxesHelper`,
   `PointLightHelper` y `CameraHelper` reaccionando al audio, con estética
   de "modo debug".
5. **Planetas cósmicos (psicodélica)** — dos capas con lógicas separadas,
   a propósito: de fondo, un fractal (Julia set) animado por shader que
   corre y muta solo a un patrón random cada tanto, **sin** seguir la
   música, con el brillo topeado bajo para que nunca tape el centro; al
   centro, un "sol" estable con un anillo de barras de nivel (como un
   ecualizador) que sí siguen el ritmo de la música. Alrededor orbitan
   planetas (algunos con anillo tipo Saturno) y cruzan meteoros de punta
   a punta. Es el modo por defecto al abrir la app.
6. **Cuerpo de energía (Alex Grey)** — homenaje a los "Sacred Mirrors"
   de [Alex Grey](https://en.wikipedia.org/wiki/Alex_Grey): una figura
   translúcida con sus 7 chakras a la vista, cada uno leyendo una banda
   de frecuencia distinta (como un ecualizador vertical) e irradiando
   líneas de energía. El mandala de fondo, con la misma lógica que el
   fractal del modo cósmico, corre solo y se mantiene tenue para nunca
   tapar la figura.

## Estructura

```
music-visualizer-threejs/
├── index.html      # Interfaz estilo WMP (barra de título, controles, playlist)
├── css/style.css   # Skin visual clásico (azules, biselados, marquee)
├── js/main.js      # Lógica del reproductor + escena Three.js
└── README.md
```

## Cómo ejecutarlo

Los módulos ES (`import * as THREE from "three"`) no funcionan abriendo
`index.html` directamente con doble clic (protocolo `file://` bloquea los
imports por CORS). Hay que servirlo con un servidor local simple:

```bash
cd music-visualizer-threejs

# Opción 1: Python (ya viene instalado en la mayoría de sistemas)
python3 -m http.server 8000

# Opción 2: Node (si tenés npx)
npx serve .
```

Después abrí `http://localhost:8000` en el navegador.

## Cómo usarlo

1. Click en **"📂 Abrir archivo"** (o arrastrá un MP3/WAV a la pantalla negra
   de visualización).
2. Se agrega a la lista de reproducción y arranca a sonar automáticamente.
3. Usá los controles ⏮ ▶/⏸ ⏹ ⏭ como en cualquier reproductor.
4. Mové el volumen y la barra de progreso con los sliders.
5. Al terminar un tema, pasa solo al siguiente de la playlist.
6. En la pestaña **"Visualizaciones"** del panel lateral, hacé click en
   cualquiera de los 6 modos para cambiar la escena en vivo.
7. Arrastrá con el mouse o el dedo sobre la visualización para girar la
   cámara; con la rueda o pellizcando, hacés zoom.
8. El botón **⛶** de la barra de título oculta toda la interfaz y deja
   solo el efecto a pantalla completa (en Chrome Android además intenta
   rotar a horizontal). Para volver, tocá el botón **"⤢ Salir"** que
   aparece arriba a la derecha, o apretá `Esc`.

## Por qué a veces tarda en verse el último cambio (caché)

GitHub Pages sirve los archivos con caché HTTP (~10 minutos) que el
navegador guarda en disco — y esa caché sobrevive aunque cierres el
navegador. Por eso `index.html` referencia `css/style.css?v=1` y
`js/main.js?v=1` con un número de versión en la URL: cada vez que se
modifica alguno de esos dos archivos, hay que subir ese número
(`?v=2`, `?v=3`, ...) en `index.html`. Al cambiar la URL, el navegador
la trata como un archivo nuevo y lo descarga de nuevo en vez de usar la
copia vieja en caché, sin importar cuánto tiempo haya pasado.

Si en algún momento ves código viejo pese a esto, probá un refresco
forzado (`Ctrl+Shift+R` / `Cmd+Shift+R`) — eso ignora la caché del todo.

## Ajustar la calidad visual

El brillo (bloom) se configura en `js/main.js`, en la línea donde se crea
`bloomPass`:

```js
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.1, 0.5, 0.2);
// parámetros: resolución, strength (intensidad), radius (difusión), threshold (umbral)
```

Si se ve muy "quemado" o muy tenue, subí/bajá `strength` (intensidad) o
`threshold` (cuánto brillo necesita un píxel para empezar a resplandecer).

## Ideas para seguir aprendiendo (próximos pasos)

- Bloom selectivo por capas (`layers`) para que solo brillen ciertos
  objetos, como en `webgl_postprocessing_unreal_bloom_selective.html`.
- Texturizar los planetas del modo cósmico (mapas de color/normal en vez
  de color plano).
- Guardar la playlist y el modo de visualización elegido en `localStorage`.
- Ecualizador gráfico real usando bandas de frecuencia (graves/medios/agudos).
- Soporte de temas/skins (oscuro, "Windows XP Royale", etc).
