<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as THREE from 'three';
	import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
	import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
	import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
	import type { MeshData, MeshPart } from '@polyscript/core';

	/** The B-Rep half of the info panel. Shaped like core's ShapeInfo, declared
	 *  structurally so @polyscript/ui keeps no dependency on the kernel. */
	export interface ShapeSummary {
		bbox?: { min: [number, number, number]; max: [number, number, number] };
		volume?: number;
		area?: number;
		solids?: number;
		is_valid?: boolean;
		topology?: { faces: number; edges: number; vertices: number };
	}

	interface Props {
		meshData?: MeshData | null;
		url?: string | null;
		showAxes?: boolean;
		showGrid?: boolean;
		/** Kernel figures for the shape on screen. Absent when the viewer was
		 *  handed a GLB (a URL): the mesh is all there is then, and the panel
		 *  shows only the mesh half. */
		info?: ShapeSummary | null;
	}

	let {
		meshData = null,
		url = null,
		showAxes = true,
		showGrid: showGridProp = true,
		info = null
	}: Props = $props();

	let container: HTMLDivElement = $state(undefined as unknown as HTMLDivElement);
	let renderer: THREE.WebGLRenderer | null = null;
	let scene: THREE.Scene | null = null;
	let camera: THREE.PerspectiveCamera | null = null;
	let controls: OrbitControls | null = null;
	let viewHelper: ViewHelper | null = null;
	// The model: a single Mesh, or a Group of one Mesh per colored part.
	let currentMesh: THREE.Object3D | null = null;
	let gridHelper: THREE.GridHelper | null = null;
	let axisHelper: THREE.AxesHelper | null = null;
	let animationId: number;
	let webglError = $state(false);
	let mounted = $state(false);
	let edgeOnly = $state(false);
	let showInfo = $state(false);
	/** Counted from the geometry actually on screen, so it works for a GLB too.
	 *  These are tessellation figures and deliberately labelled apart from the
	 *  B-Rep ones: a box has 8 CAD vertices and 24 mesh vertices. */
	let meshStats = $state<{ triangles: number; vertices: number } | null>(null);
	let showAxisState = $state(true);
	let showGridState = $state(true);
	let hasLoadedOnce = false;

	$effect(() => {
		showAxisState = showAxes;
	});
	$effect(() => {
		showGridState = showGridProp;
	});

	/**
	 * Where the camera sits to show a model whole: the +X -Y +Z octant, the
	 * same side the CLI calls `iso`.
	 *
	 * Shared by the reset button and by the thumbnail, so the picture in a
	 * listing is the view the author gets when they open the model.
	 */
	function isoView(mesh: THREE.Object3D): { position: THREE.Vector3; target: THREE.Vector3 } {
		const box = new THREE.Box3().setFromObject(mesh);
		const target = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z);
		return {
			position: new THREE.Vector3(
				target.x + maxDim * 1.2,
				target.y - maxDim * 1.2,
				target.z + maxDim * 0.8
			),
			target
		};
	}

	function fitCamera(mesh: THREE.Object3D) {
		if (!camera || !controls) return;
		const { position, target } = isoView(mesh);
		camera.position.copy(position);
		controls.target.copy(target);
		controls.update();
	}

	function resetView() {
		if (!currentMesh) return;
		fitCamera(currentMesh);
	}

	function toggleEdgeOnly() {
		edgeOnly = !edgeOnly;
		applyEdgeOnly();
	}

	function applyEdgeOnly() {
		if (!currentMesh) return;
		currentMesh.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			const mat = child.material as THREE.MeshPhongMaterial;
			// A part's own alpha (color ... alpha:0.5) is the resting opacity.
			const alpha: number = child.userData.alpha ?? 1;
			mat.transparent = edgeOnly || alpha < 1;
			mat.opacity = edgeOnly ? 0 : alpha;
			mat.depthWrite = !edgeOnly && alpha >= 1;
		});
	}

	function toggleAxis() {
		showAxisState = !showAxisState;
		if (axisHelper) axisHelper.visible = showAxisState;
	}

	function toggleGrid() {
		showGridState = !showGridState;
		if (gridHelper) gridHelper.visible = showGridState;
	}

	function removeMesh() {
		if (!scene) return;
		if (!currentMesh) return;
		scene.remove(currentMesh);
		currentMesh.traverse((child) => {
			if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
				child.geometry.dispose();
				const mat = child.material;
				if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
				else (mat as THREE.Material).dispose();
			}
		});
		currentMesh = null;
		meshStats = null;
	}

	/** Four significant-ish digits without exponents: these are millimetres and
	 *  cubic millimetres, and 1802.7 reads better than 1802.7135009765625. */
	function fmt(n: number): string {
		const abs = Math.abs(n);
		if (abs >= 1000) return n.toFixed(0);
		if (abs >= 1) return n.toFixed(1);
		return n.toPrecision(2);
	}

	function countMesh(root: THREE.Object3D): { triangles: number; vertices: number } {
		let triangles = 0;
		let vertices = 0;
		root.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			const geo = child.geometry as THREE.BufferGeometry;
			const pos = geo.getAttribute('position');
			if (!pos) return;
			vertices += pos.count;
			const index = geo.getIndex();
			triangles += (index ? index.count : pos.count) / 3;
		});
		return { triangles: Math.round(triangles), vertices };
	}

	function loadMesh(mesh: THREE.Object3D) {
		if (!scene) return;
		removeMesh();
		currentMesh = mesh;
		meshStats = countMesh(mesh);
		scene.add(mesh);
		if (!hasLoadedOnce) {
			fitCamera(mesh);
			hasLoadedOnce = true;
		}
	}

	function partGeometry(part: MeshPart | MeshData): THREE.BufferGeometry {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
		if (part.normals && part.normals.length > 0) {
			geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
		}
		geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));
		if (!geometry.getAttribute('normal')) {
			geometry.computeVertexNormals();
		}
		return geometry;
	}

	function partMaterial(color: [number, number, number] | undefined, colors?: Float32Array): THREE.MeshPhongMaterial {
		if (colors) {
			return new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x222222, shininess: 40 });
		}
		const rgb = color ?? [1.0, 0.92, 0.3];
		return new THREE.MeshPhongMaterial({
			color: new THREE.Color(rgb[0], rgb[1], rgb[2]),
			specular: 0x222222,
			shininess: 40
		});
	}

	function edgeMaterial(): THREE.LineBasicMaterial {
		return new THREE.LineBasicMaterial({ color: 0x000000 });
	}

	/**
	 * A Three.js object standing in for one build's result.
	 *
	 * Split out from `loadFromMeshData` so a thumbnail can be taken of a mesh
	 * that is not the one on screen -- the editor renders the listing picture
	 * from a build at the model's default parameters while the author keeps
	 * looking at whatever they were trying.
	 */
	function buildObject3D(data: MeshData): THREE.Object3D {
		const parts = data.parts ?? [];
		const hasFaces = parts.length > 0 || (data.positions.length > 0 && data.indices.length > 0);
		const hasLines = data.lines && data.lines.positions.length > 0 && data.lines.indices.length > 0;

		// Build a Three.js object to stand in for the current shape: one Mesh for
		// a monochrome model, a Group of Meshes when parts carry their own colors.
		// If there are no faces (only open-wire lines), use an empty placeholder
		// mesh so the existing view-fit logic still works via bbox of children.
		let mesh: THREE.Object3D;
		if (parts.length > 0) {
			const group = new THREE.Group();
			for (const part of parts) {
				const m = new THREE.Mesh(partGeometry(part), partMaterial(part.color));
				m.userData.alpha = part.alpha ?? 1;
				group.add(m);
			}
			if (data.edgePoints && data.edgePoints.length > 0) {
				const edgeGeometry = new THREE.BufferGeometry();
				edgeGeometry.setAttribute('position', new THREE.BufferAttribute(data.edgePoints, 3));
				group.add(new THREE.LineSegments(edgeGeometry, edgeMaterial()));
			} else {
				// No CAD edges supplied: outline each part from its own geometry.
				for (const child of [...group.children]) {
					if (child instanceof THREE.Mesh) {
						group.add(new THREE.LineSegments(new THREE.EdgesGeometry(child.geometry, 10), edgeMaterial()));
					}
				}
			}
			mesh = group;
		} else if (hasFaces) {
			const geometry = partGeometry(data);
			if (data.colors) {
				geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
			}
			const single = new THREE.Mesh(geometry, partMaterial(data.color, data.colors));
			if (data.edgePoints && data.edgePoints.length > 0) {
				const edgeGeometry = new THREE.BufferGeometry();
				edgeGeometry.setAttribute('position', new THREE.BufferAttribute(data.edgePoints, 3));
				single.add(new THREE.LineSegments(edgeGeometry, edgeMaterial()));
			} else {
				single.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 10), edgeMaterial()));
			}
			mesh = single;
		} else {
			// No face data — create an empty mesh placeholder
			mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhongMaterial({ visible: false }));
		}

		// Add open-wire lines (path literals etc.) as a separate LineSegments child.
		if (hasLines) {
			const lineGeom = new THREE.BufferGeometry();
			lineGeom.setAttribute('position', new THREE.BufferAttribute(data.lines!.positions, 3));
			lineGeom.setIndex(new THREE.BufferAttribute(data.lines!.indices, 1));
			// Orchid (purple-pink) to stand out from primary colors
			// (blue/red/green/yellow) that are typically used for axes and faces.
			const wireLines = new THREE.LineSegments(
				lineGeom,
				new THREE.LineBasicMaterial({ color: 0xba55d3, linewidth: 2 })
			);
			mesh.add(wireLines);
		}

		return mesh;
	}

	function loadFromMeshData(data: MeshData) {
		loadMesh(buildObject3D(data));
		applyEdgeOnly();
	}

	/** Release what `buildObject3D` allocated. Nothing else holds it. */
	function disposeObject3D(root: THREE.Object3D) {
		root.traverse((child) => {
			const any = child as THREE.Mesh | THREE.LineSegments;
			any.geometry?.dispose();
			const mat = any.material;
			if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
			else mat?.dispose();
		});
	}

	function loadFromUrl(glbUrl: string) {
		new GLTFLoader().load(glbUrl, (gltf) => {
			// The whole scene, not just its first mesh: a preview GLB carries
			// the CAD edges as a LINES primitive beside the faces, which the
			// loader makes a Group of a Mesh and a LineSegments.
			loadMesh(gltf.scene);
		});
	}

	// React to meshData / url changes after mount
	$effect(() => {
		const _data = meshData;
		const _url = url;
		if (!mounted) return;
		if (_data) {
			loadFromMeshData(_data);
		} else if (_url) {
			loadFromUrl(_url);
		} else {
			removeMesh();
		}
	});

	onMount(() => {
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0xf7fafc);

		camera = new THREE.PerspectiveCamera(
			50,
			container.clientWidth / container.clientHeight,
			0.1,
			10000
		);
		camera.up.set(0, 0, 1);

		try {
			renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
		} catch {
			webglError = true;
			return;
		}
		renderer.setSize(container.clientWidth, container.clientHeight);
		renderer.setPixelRatio(window.devicePixelRatio);
		renderer.autoClear = false;
		container.appendChild(renderer.domElement);

		controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;

		viewHelper = new ViewHelper(camera, renderer.domElement);
		viewHelper.setLabels('X', 'Y', 'Z');
		renderer.domElement.addEventListener('pointerup', (event) => {
			viewHelper!.handleClick(event);
		});

		scene.add(new THREE.AmbientLight(0xffffff, 0.6));
		const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
		dirLight.position.set(1, 1, 1);
		scene.add(dirLight);
		const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
		backLight.position.set(-1, -1, -1);
		scene.add(backLight);

		gridHelper = new THREE.GridHelper(100, 20, 0xcccccc, 0xe0e0e0);
		gridHelper.rotation.x = Math.PI / 2;
		gridHelper.visible = showGridState;
		scene.add(gridHelper);

		axisHelper = new THREE.AxesHelper(50);
		axisHelper.visible = showAxisState;
		scene.add(axisHelper);

		camera.position.set(60, -60, 40);
		controls.update();

		const timer = new THREE.Timer();
		function animate() {
			animationId = requestAnimationFrame(animate);
			timer.update();
			const delta = timer.getDelta();
			controls!.update();
			if (viewHelper!.animating) viewHelper!.update(delta);
			renderer!.clear();
			renderer!.render(scene!, camera!);
			viewHelper!.render(renderer!);
		}
		animate();

		const ro = new ResizeObserver(() => {
			if (!renderer || !camera) return;
			const w = container.clientWidth;
			const h = container.clientHeight;
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h);
		});
		ro.observe(container);

		mounted = true;

		// Load initial data
		if (meshData) {
			loadFromMeshData(meshData);
		} else if (url) {
			loadFromUrl(url);
		}

		return () => ro.disconnect();
	});

	onDestroy(() => {
		if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animationId);
		renderer?.dispose();
	});

	export function exportSVG(): string {
		if (!currentMesh || !camera || !renderer) throw new Error('Not ready');
		const w = renderer.domElement.width;
		const h = renderer.domElement.height;

		// Collect edge line segments in world space
		const segments: [THREE.Vector3, THREE.Vector3][] = [];
		currentMesh.traverse((child) => {
			if (child instanceof THREE.LineSegments) {
				const geo = child.geometry;
				const pos = geo.getAttribute('position');
				child.updateMatrixWorld(true);
				for (let i = 0; i < pos.count; i += 2) {
					const a = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
					const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(child.matrixWorld);
					segments.push([a, b]);
				}
			}
		});

		// Project to screen coords
		const project = (v: THREE.Vector3): [number, number] => {
			const ndc = v.clone().project(camera!);
			return [(ndc.x + 1) / 2 * w, (1 - ndc.y) / 2 * h];
		};

		let lines = '';
		for (const [a, b] of segments) {
			const [x1, y1] = project(a);
			const [x2, y2] = project(b);
			lines += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>\n`;
		}

		return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<g stroke="#000" stroke-width="1" stroke-linecap="round">
${lines}</g>
</svg>`;
	}

	/**
	 * PNG of the model as the camera currently frames it, without the grid and
	 * the axes.
	 *
	 * Those two are viewing aids, not part of the model, and every consumer of
	 * this wants the model: the download menus in both apps, and the thumbnail
	 * objhub uploads with a save. It used to read the canvas as-is, which
	 * captured whatever the last frame happened to contain -- grid lines
	 * included -- so the toolbar's camera button had its own cleaner copy of
	 * this code. One implementation now, and the two agree.
	 */
	/**
	 * The picture a listing shows.
	 *
	 * Deliberately not a screenshot of what is on screen. That came out at
	 * whatever size the author's window happened to be, in whatever direction
	 * they had last dragged the model to, so a page of cards was a page of
	 * different framings -- and it could not be taken at all while the preview
	 * panel was collapsed. This renders the model by itself: always this size,
	 * always the iso view, grid and axes off, and the live camera untouched.
	 *
	 * Drawn into a render target rather than the canvas, so nothing flickers
	 * and no second WebGL context is created -- contexts are the scarce thing
	 * here, which is why the listing stopped using live viewers in the first
	 * place.
	 */
	export async function renderThumbnail(
		data?: MeshData | null,
		width = 800,
		height = 600
	): Promise<Blob> {
		if (!renderer || !scene) {
			throw new Error('Renderer not ready');
		}

		// A mesh of its own, or the one on screen. The first is how the editor
		// gets a listing picture of the model at its default parameters
		// without disturbing the view the author is working in.
		const temp = data ? buildObject3D(data) : null;
		if (temp) scene.add(temp);
		const subject = temp ?? currentMesh;
		if (!subject) {
			throw new Error('Nothing to render');
		}

		const cam = new THREE.PerspectiveCamera(50, width / height, 0.1, 10000);
		cam.up.set(0, 0, 1);
		const { position, target } = isoView(subject);
		cam.position.copy(position);
		cam.lookAt(target);

		const gridWas = gridHelper?.visible ?? false;
		const axisWas = axisHelper?.visible ?? false;
		if (gridHelper) gridHelper.visible = false;
		if (axisHelper) axisHelper.visible = false;
		// The live model would otherwise sit in the shot beside the temporary
		// one, at whatever parameters it was last built with.
		const meshWas = currentMesh?.visible ?? false;
		if (temp && currentMesh) currentMesh.visible = false;

		const rt = new THREE.WebGLRenderTarget(width, height, {
			// The default is nearest; a listing shows these scaled down.
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter
		});
		try {
			renderer.setRenderTarget(rt);
			renderer.clear();
			renderer.render(scene, cam);

			const pixels = new Uint8Array(width * height * 4);
			renderer.readRenderTargetPixels(rt, 0, 0, width, height, pixels);

			// WebGL reads bottom-up; a PNG is top-down.
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('2D context unavailable');
			const image = ctx.createImageData(width, height);
			const row = width * 4;
			for (let y = 0; y < height; y++) {
				image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
			}
			ctx.putImageData(image, 0, 0);

			return await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG'))), 'image/png');
			});
		} finally {
			renderer.setRenderTarget(null);
			rt.dispose();
			if (gridHelper) gridHelper.visible = gridWas;
			if (axisHelper) axisHelper.visible = axisWas;
			if (currentMesh) currentMesh.visible = meshWas;
			if (temp) {
				scene.remove(temp);
				disposeObject3D(temp);
			}
		}
	}

	export async function screenshot(): Promise<Blob> {
		if (!renderer || !scene || !camera) {
			throw new Error('Renderer not ready');
		}

		const gridWas = gridHelper?.visible ?? false;
		const axisWas = axisHelper?.visible ?? false;
		if (gridHelper) gridHelper.visible = false;
		if (axisHelper) axisHelper.visible = false;

		try {
			renderer.clear();
			renderer.render(scene, camera);
			return await new Promise<Blob>((resolve, reject) => {
				renderer!.domElement.toBlob(
					(b) => {
						if (b) resolve(b);
						else reject(new Error('Failed to capture screenshot'));
					},
					'image/png'
				);
			});
		} finally {
			// Restored even on failure: leaving the grid hidden would look like
			// the toggle stopped working.
			if (gridHelper) gridHelper.visible = gridWas;
			if (axisHelper) axisHelper.visible = axisWas;
		}
	}

	async function takeScreenshot(): Promise<void> {
		const blob = await screenshot();

		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `polyscript_${ts}.png`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

{#if webglError}
	<div class="viewer fallback">
		<p>3D preview unavailable (WebGL not supported)</p>
	</div>
{:else}
	<div class="viewer-wrapper">
		<div class="viewer" bind:this={container}></div>
		<div class="viewer-toolbar">
			<button class="tb-btn" onclick={resetView} title="Reset view">&#x27F3;</button>
			<button class="tb-btn" class:active={edgeOnly} onclick={toggleEdgeOnly} title="Edge only">&#x25C7;</button>
			<button class="tb-btn" class:active={showAxisState} onclick={toggleAxis} title="Axes">&#x22B9;</button>
			<button class="tb-btn" class:active={showGridState} onclick={toggleGrid} title="Grid">&#x229E;</button>
			<button
				class="tb-btn"
				class:active={showInfo}
				onclick={() => (showInfo = !showInfo)}
				title="Model info"
				aria-pressed={showInfo}
			>&#x24D8;</button>
			<button class="tb-btn" onclick={takeScreenshot} title="Screenshot">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<rect x="2" y="7" width="20" height="14" rx="2"/>
					<circle cx="12" cy="14" r="4"/>
					<path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
				</svg>
			</button>
		</div>

		{#if showInfo && (info || meshStats)}
			<div class="viewer-info">
				{#if info?.bbox}
					<div class="info-row">
						<span>Size</span>
						<b>{fmt(info.bbox.max[0] - info.bbox.min[0])} × {fmt(info.bbox.max[1] - info.bbox.min[1])} × {fmt(info.bbox.max[2] - info.bbox.min[2])}</b>
					</div>
				{/if}
				{#if info?.volume !== undefined}
					<div class="info-row"><span>Volume</span><b>{fmt(info.volume)}</b></div>
				{/if}
				{#if info?.area !== undefined}
					<div class="info-row"><span>Area</span><b>{fmt(info.area)}</b></div>
				{/if}
				{#if info?.topology}
					<div class="info-row"><span>Face / Edge / Vert</span><b>{info.topology.faces} / {info.topology.edges} / {info.topology.vertices}</b></div>
				{/if}
				{#if info?.solids !== undefined}
					<div class="info-row"><span>Solids</span><b>{info.solids}</b></div>
				{/if}
				{#if info?.is_valid === false}
					<div class="info-row invalid"><span>Validity</span><b>invalid</b></div>
				{/if}
				{#if meshStats}
					<div class="info-row mesh">
						<span>Mesh tri / vert</span>
						<b>{meshStats.triangles.toLocaleString()} / {meshStats.vertices.toLocaleString()}</b>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.viewer {
		width: 100%;
		height: 100%;
		min-height: 200px;
	}
	.viewer-wrapper {
		position: relative;
		width: 100%;
		height: 100%;
	}
	.viewer-toolbar {
		position: absolute;
		top: 6px;
		left: 6px;
		display: flex;
		gap: 2px;
		background: rgba(255, 255, 255, 0.85);
		border-radius: 6px;
		padding: 2px;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
		z-index: 10;
	}
	.tb-btn {
		width: 28px;
		height: 28px;
		border: none;
		background: transparent;
		border-radius: 4px;
		cursor: pointer;
		font-size: 15px;
		line-height: 28px;
		text-align: center;
		color: #555;
		padding: 0;
	}
	.tb-btn:hover {
		background: #e2e8f0;
	}
	.tb-btn.active {
		background: #e6fffa;
		color: #319795;
	}
	/* Opposite corner from the toolbar so it never covers the controls. */
	.viewer-info {
		position: absolute;
		bottom: 6px;
		left: 6px;
		z-index: 10;
		min-width: 168px;
		padding: 6px 8px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.9);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
		font-size: 11px;
		line-height: 1.6;
		color: #4a5568;
		font-variant-numeric: tabular-nums;
	}
	.info-row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.info-row span {
		color: #a0aec0;
	}
	.info-row.mesh {
		margin-top: 3px;
		padding-top: 3px;
		border-top: 1px solid #e2e8f0;
	}
	.info-row.invalid b {
		color: #e53e3e;
	}
	.fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		background: #f7fafc;
		color: #a0aec0;
		height: 100%;
		min-height: 200px;
	}
</style>
