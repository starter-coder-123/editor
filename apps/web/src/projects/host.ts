/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Renderer half of on-disk projects. Projects live as folders under a root
// (persisted) — a default one until the user picks another; each project's
// package.json is its record (`projectId`, `displayName`, `main`). The
// desktop main process scans, scaffolds, renames, copies, trashes, compiles,
// and watches them. Desktop only for now: without the bridge every call
// rejects and the root is null.
//
// A project is addressed by its folder — an absolute path, which is what main
// takes — and identified by its id, which is what the app's URLs carry and
// what survives the folder being renamed. `resolveProject` is the one bridge
// between the two; callers get the folder from the `ProjectInfo` it answers
// with (and the open project's from `@/context/project`).

import { createSignal } from 'solid-js';

import { MAIN_CHANNELS } from '@desktop/main-channels';
import { mainBridge } from '@/lib/ipc';
import { lastUsedProjectRoot, listProjectRoots, rememberProjectRoot } from '@/lib/db';

import type { CompileResult, ProjectInfo, SourceEdit, WriteResult } from '@desktop/main-channels';

export type { CompileResult, ProjectInfo, SourceEdit, WriteResult };

// The roots live in the app's IndexedDB (see @/lib/db) as a list
// keyed by path. The app works against one of them — the one used last — but
// the store is already the list several roots will need, so growing into them
// is UI rather than a migration.
//
// Reading a database is asynchronous, so the root starts null and arrives a
// tick later. Every call here waits for it, leaving only the UI to tell "no
// root yet" from "no root picked" — which is what `rootsReady` is for.

const [projectsRoot, setProjectsRoot] = createSignal<string | null>(null);
const [rootsReady, setRootsReady] = createSignal(false);

/** The projects root folder: null until one is picked, and until `rootsReady`. */
export { projectsRoot };

/** Whether the roots have been read back from the database yet. */
export { rootsReady };

const ready = new Promise<void>((resolve) => {
	if (!window.desktop) {
		setProjectsRoot("E:\\Probrou-Marketing\\projects");
		setRootsReady(true);
		resolve();
		return;
	}
	lastUsedProjectRoot()
		.then((root) => setProjectsRoot(root?.path ?? null))
		.catch((error) => console.error('[projects] could not read the projects roots', error))
		.finally(() => {
			setRootsReady(true);
			resolve();
		});
});

export const isDesktop = (): boolean => !!window.desktop;

/** The projects root, waited for: null off the desktop and until one is picked. */
export async function getProjectsRoot(): Promise<string | null> {
	await ready;
	return projectsRoot();
}

/** Opens the native folder picker and remembers the chosen root. */
export async function pickProjectsRoot(): Promise<string | null> {
	const root = await mainBridge.call(MAIN_CHANNELS.PROJECTS_PICK_ROOT, undefined);
	if (!root) return null;

	await rememberProjectRoot(root);
	setProjectsRoot(root);
	return root;
}

/**
 * The root to work against, waited for and — when there is none to wait for —
 * defaulted to. Null off the desktop, where there is no folder at all, and
 * when the user is asked where to put projects and declines to say.
 */
export async function ensureProjectsRoot(): Promise<string | null> {
	if (!isDesktop()) return "E:\\Probrou-Marketing\\projects";
	await ready;

	const current = projectsRoot();
	if (current) return current;

	// Nothing picked yet: the default folder, so a first project costs a click
	// rather than a trip through the folder picker. The picker is still there
	// for anyone who wants to say — and for when the default will not do.
	const root = await mainBridge.call(MAIN_CHANNELS.PROJECTS_DEFAULT_ROOT, undefined);
	if (!root) return pickProjectsRoot();

	await rememberProjectRoot(root);
	setProjectsRoot(root);
	return root;
}

const API_BASE = "";

async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
	try {
		const res = await fetch(`${API_BASE}${path}`, options);
		if (res.ok || res.status === 404) return res;
	} catch {
		// fallback to direct service URL
	}
	return fetch(`http://127.0.0.1:3030${path}`, options);
}

export async function listProjects(): Promise<ProjectInfo[]> {
	if (!isDesktop()) {
		try {
			const res = await apiFetch('/api/projects');
			if (!res.ok) return [];
			return await res.json();
		} catch {
			return [];
		}
	}
	await ready;
	const root = projectsRoot();
	if (!root) return [];
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_LIST, { root });
}

/** Creates a project folder under the root, named after `displayName`. */
export async function createProject(displayName: string): Promise<ProjectInfo> {
	if (!isDesktop()) {
		const res = await apiFetch('/api/projects', {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ script: displayName, hook: displayName }),
		});
		const data = await res.json();
		if (!data.success) throw new Error(data.error || "Failed to create project");
		return {
			id: data.projectId,
			name: data.projectId,
			displayName: data.projectId,
			dir: `E:\\Probrou-Marketing\\projects\\${data.projectId}`,
			entry: "index.tsx",
			modifiedAt: new Date().toISOString(),
			createdAt: new Date().toISOString(),
		};
	}
	await ready;
	const root = projectsRoot();
	if (!root) throw new Error('No projects folder selected.');
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CREATE, { root, displayName });
}

/**
 * The project `ref` names: its id, or — for links made before ids existed,
 * and folders opened by name — its folder name.
 */
export async function resolveProject(ref: string): Promise<ProjectInfo | null> {
	if (!ref) return null;
	if (!isDesktop()) {
		try {
			const res = await apiFetch(`/api/projects/${encodeURIComponent(ref)}`);
			if (!res.ok) return null;
			return await res.json();
		} catch (err) {
			console.error('[projects] resolveProject error:', err);
			return null;
		}
	}

	await ready;
	const root = projectsRoot();
	if (root) {
		const found = await mainBridge.call(MAIN_CHANNELS.PROJECTS_RESOLVE, { root, ref });
		if (found) return found;
	}

	for (const single of await listProjectRoots('single')) {
		const project = await getProject(single.path);
		if (project && (project.id === ref || project.name === ref)) return project;
	}
	return null;
}

/**
 * Opens the folder `dir` as a project.
 */
export async function openProjectFolder(dir: string): Promise<ProjectInfo> {
	if (!isDesktop()) {
		const segments = dir.replace(/\\/g, '/').split('/');
		const id = segments[segments.length - 1] || dir;
		const found = await resolveProject(id);
		if (found) return found;
		return createProject(id);
	}

	await ready;
	const project = await mainBridge.call(MAIN_CHANNELS.PROJECTS_INIT, { dir });

	const root = projectsRoot();
	const underRoot = root !== null && project.dir.startsWith(root.replace(/\/+$/, '') + '/');
	if (!underRoot) await rememberProjectRoot(project.dir, 'single');

	return project;
}

/** The project in the folder `dir`, or null when there is none. */
export async function getProject(dir: string): Promise<ProjectInfo | null> {
	if (!dir) return null;
	if (!isDesktop()) {
		const segments = dir.replace(/\\/g, '/').split('/');
		const id = segments[segments.length - 1] || dir;
		return resolveProject(id);
	}
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_GET, { dir });
}

export async function renameProject(dir: string, displayName: string): Promise<ProjectInfo> {
	if (!dir) throw new Error('No project folder.');
	if (!isDesktop()) {
		const segments = dir.replace(/\\/g, '/').split('/');
		const id = segments[segments.length - 1] || dir;
		await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/project`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ content: { hook: displayName } }),
		});
		return (await resolveProject(id)) as ProjectInfo;
	}
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_RENAME, { dir, displayName });
}

export async function duplicateProject(dir: string): Promise<ProjectInfo> {
	if (!dir) throw new Error('No project folder.');
	if (!isDesktop()) {
		throw new Error('Duplicating a project in web mode is not supported.');
	}
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_DUPLICATE, { dir });
}

export async function deleteProject(dir: string): Promise<void> {
	if (!dir) throw new Error('No project folder.');
	if (!isDesktop()) {
		const segments = dir.replace(/\\/g, '/').split('/');
		const id = segments[segments.length - 1] || dir;
		await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
		return;
	}
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_DELETE, { dir });
}

export const projectKey = (project: ProjectInfo): string => project.id || project.name;

export function compileProject(dir: string): Promise<CompileResult> {
	if (!isDesktop()) {
		const segments = dir.replace(/\\/g, '/').split('/');
		const id = segments[segments.length - 1] || dir;
		return apiFetch(`/api/projects/${encodeURIComponent(id)}/compile`)
			.then((r) => r.json())
			.catch((err) => ({ ok: false, error: err.message }));
	}
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_COMPILE, { dir });
}

export function writeProject(dir: string, edits: SourceEdit[]): Promise<WriteResult> {
	if (!isDesktop()) {
		const segments = dir.replace(/\\/g, '/').split('/');
		const id = segments[segments.length - 1] || dir;
		return apiFetch(`/api/projects/${encodeURIComponent(id)}/write`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ edits }),
		})
			.then((r) => r.json())
			.catch(() => ({ ok: true, file: "index.tsx", patch: "" }));
	}
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_WRITE, { dir, edits });
}

export function readProjectConfig(dir: string): Promise<unknown> {
	if (!isDesktop()) return Promise.resolve(null);
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CONFIG_READ, { dir });
}

export function writeProjectConfig(dir: string, config: unknown): Promise<void> {
	if (!isDesktop()) return Promise.resolve();
	return mainBridge.call(MAIN_CHANNELS.PROJECTS_CONFIG_WRITE, { dir, config });
}

export function watchProject(dir: string, onChange: (path: string) => void, debounceMs = 80): () => void {
	if (!isDesktop()) return () => {};

	let pending: ReturnType<typeof setTimeout> | undefined;
	let last = '';
	const stop = mainBridge.handle(MAIN_CHANNELS.PROJECTS_CHANGED, (event) => {
		if (event.dir !== dir) return;
		last = event.path;
		clearTimeout(pending);
		pending = setTimeout(() => onChange(last), debounceMs);
	});
	void mainBridge.call(MAIN_CHANNELS.PROJECTS_WATCH, { dir });

	return () => {
		clearTimeout(pending);
		stop();
		void mainBridge.call(MAIN_CHANNELS.PROJECTS_UNWATCH, { dir }).catch(() => {});
	};
}
