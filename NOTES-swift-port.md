# NOTES-swift-port — перенос веб-прототипа на iPhone (Swift)

Что из текущего веб-прототипа (three.js r160 + Rapier, game/*.js) переносится в нативную игру как есть, а что придётся заменить.
Owner: Optimization thread. Цифры по состоянию master на 2026-11-23.

## 1. Выбор движка

| Вариант | За | Против |
|---|---|---|
| **RealityKit 4 (iOS 18+)** | PBR, тени, анимации скелета, ECS, физика, `ShaderGraphMaterial` (MaterialX), низкий расход батареи, Reality Composer Pro | Ограниченные кастомные шейдеры (только Shader Graph, без произвольного GLSL/MSL во фрагменте), нет своей постобработки до iOS 18 `PostProcessEffect`, мало контроля над тенями (одна направленная + spot), точечных теней нет |
| **Metal + своя рендер-петля (MetalKit)** | Полный контроль: всё, что есть сейчас в шейдерах, переносится 1:1 в MSL; свой пайплайн теней, тумана и постобработки | Больше кода: свой загрузчик glTF, скиннинг, culling, шейдеры света |
| **SceneKit** | Проще RealityKit для кастомных шейдеров (`shaderModifiers` ≈ `onBeforeCompile`) | Apple его больше не развивает (deprecated в пользу RealityKit) |

Рекомендация: **RealityKit для сцены, героя, физики и ввода + `CustomMaterial`/Metal surface/geometry modifiers для ветра и досок + `PostProcessEffect` (iOS 18) для грейдинга и тумана**. Если Shader Graph окажется тесен для тумана, берём Metal целиком: архитектура game/*.js уже модульная и сама просится в ECS-системы.

## 2. Что переносится 1:1

| Сейчас (веб) | В Swift |
|---|---|
| Модули-системы: tree, props, env, ground, lights, hero, brain, wind, rain, camera, audio, perf | ECS `System` (RealityKit) или по классу на систему; общий тик `update(dt)` уже есть у каждой |
| brain.js: ИИ «нужды → выбор занятия» (чистая логика, без three.js) | Переписывается почти построчно на Swift (структуры `Need`, `Activity`, взвешенная лотерея) |
| hero.js: граф точек + BFS, задачи, корневое движение (root motion) | `NavGraph` + BFS в Swift; клипы Meshy в USDZ, `AnimationResource`, root motion: смещение таза из клипа так же переносится в корень |
| Rapier: доски fixed/dynamic, trimesh ствола, CCD стрел, ragdoll | RealityKit `PhysicsBodyComponent` (`.static/.dynamic`), `ShapeResource.generateStaticMesh` для ствола, CCD есть; ragdoll: сочленения из капсул (iOS 18 `PhysicsJoints`) |
| glTF-модели (oak, hero, zombie) | Конвертировать в USDZ (`usdzconvert` / Reality Converter / Blender). Meshopt не нужен: USDZ грузится нативно |
| InstancedMesh (трава, листья, камни, грибы, щепки) | RealityKit `MeshInstancesComponent` (iOS 18) или один слитый меш; в Metal — `drawIndexedPrimitives(instanceCount:)` |
| Процедурная мебель (props.js строит геометрию и canvas-текстуры в коде) | Один раз «запечь»: экспорт в glTF/USDZ из браузера (`GLTFExporter`), canvas-текстуры в PNG/KTX2. Генерировать на телефоне при каждом запуске незачем |
| Смена дня и ночи: таблица `K` цветов неба/тумана/солнца по часам | Та же таблица, интерполяция в Swift |
| Регулятор качества perf.js (шаги, пропуски vsync) | Тот же алгоритм; на iPhone есть настоящее время GPU (`MTLCommandBuffer.gpuEndTime − gpuStartTime`), так что судить можно точнее |
| Звук (WebAudio: шум ветра, дождь, синтез тонов) | `AVAudioEngine` + `AVAudioSourceNode`; ветровые события из wind.js переносятся как есть |

## 3. Что придётся заменить

| Возможность three.js | Где используется | Замена |
|---|---|---|
| `onBeforeCompile` (вставка GLSL в стандартный PBR-шейдер) — 37 мест: ground 11, treedress 8, tree 4, index 5, lights 3, rain 3, camera 3 | ветер (сдвиг вершин), доски (рисунок досок в шейдере), стекло с френелем, мокрые поверхности, тёплое свечение окон | RealityKit `CustomMaterial` с `geometryModifier` (вершины: ветер) и `surfaceShader` (цвет: доски, мокрость), всё на Metal Shading Language. Каждую вставку переписать с GLSL на MSL: логика та же |
| `ShaderMaterial` целиком (небо, листы тумана, fogbank, дым, капли, светлячки) — ~20 материалов | env, fogbank, smoke, rain, ground, lights | `CustomMaterial` с `.unlit` + surface shader, либо свой Metal-проход. Небо: сфера с unlit-материалом или `EnvironmentResource` |
| Шум fbm в тумане (несколько полноэкранных слоёв × 5 октав) | env.js, fogbank.js | Не переносить как есть: в нативе туман = один объёмный/высотный туман в постобработке + 1-2 текстуры шума (дешевле в 5-10 раз) |
| `scene.fog` (линейный туман во всех материалах) | везде | RealityKit: нет встроенного тумана → в `PostProcessEffect` по глубине; Metal: в фрагментном шейдере |
| EffectComposer: RenderPass, UnrealBloom, DOF, грейдинг (ShaderPass), OutputPass | index.html, env.js, camera.js | iOS 18 `RealityViewCameraContent` + `PostProcessEffect` (Metal compute/MPS): `MPSImageGaussianBlur` для bloom/DOF, грейдинг одним compute-ядром |
| PCF-тени: солнце 1024-2048 + spot + точечные (кубические) | lights.js, index.html | RealityKit: `DirectionalLightComponent.Shadow` и `SpotLightComponent.Shadow`; **точечных теней нет** → фонари без теней или запечённые тени (lightmap) для статичной мебели |
| 16 динамических точечных ламп в каждом шейдере | lights.js | RealityKit тянет ~8 динамических огней разумно; комнаты лучше запечь (lightmap/AO) и оставить 3-4 живых лампы |
| `alphaTest` + `DoubleSide` карточки листвы и травы | tree, treedress, ground | `CustomMaterial` с `discard_fragment()` (или `opacityThreshold` в `PhysicallyBasedMaterial`); на Apple GPU (TBDR) alpha-test дорогой: меньше и крупнее карточки |
| `dithering` (rain.js) и dithered fade | rain, переходы | В MSL: порог по Bayer-матрице 4×4 в surface shader |
| `customProgramCacheKey`, `layers`, `renderOrder` | разные | RealityKit: `ModelSortGroupComponent` для порядка прозрачных; кэш программ не нужен (шейдеры компилируются заранее в .metallib — нет фризов при загрузке) |
| Base64 `.txt` модели и текстуры, KTX2/Basis | загрузка | Ассеты внутри app bundle: USDZ + ASTC (`.ktx` или Asset Catalog texture sets) — сжатие на GPU бесплатно, без транскодера |
| CanvasTexture (подписи банок, одеяла, ковры, листья) | props, treedress, wind | Запечь в PNG один раз |
| `requestAnimationFrame` + `devicePixelRatio` + регулятор px | index, perf | `CADisplayLink` / RealityKit render loop, `contentScaleFactor`; ProMotion 120 Гц: целиться в 60 с возможностью 120 |
| Указатели (pointer events: вращение, щипок, тап) | camera.js | `UIPanGestureRecognizer`, `UIPinchGestureRecognizer`, `UITapGestureRecognizer` |
| `localStorage` (настройки) | perf, brain | `UserDefaults` |

## 4. Что сделать ещё в вебе, чтобы перенос был проще
- Держать системы независимыми от three.js там, где это логика (brain.js уже так): данные отдельно, отрисовка отдельно.
- Запечь процедурную мебель и canvas-текстуры в файлы (это и загрузку веба ускорит).
- Каждый `onBeforeCompile` сопровождать комментарием «что делает» одной строкой: по нему будет писаться MSL.
- Туман перевести на текстурный шум/половинное разрешение уже в вебе (идёт: Env + Wind) — тогда в нативе он ляжет в один проход.

## 5. Бюджет для iPhone (цель натива)
- 60 FPS при 2× масштабе экрана, ≤ 200 draw calls, ≤ 300k треугольников в кадре, ≤ 8 живых огней, 1 карта теней солнца 2048 + 1 spot.
- Память GPU ≤ 300 МБ (текстуры ASTC, без несжатых 2K RGBA).
